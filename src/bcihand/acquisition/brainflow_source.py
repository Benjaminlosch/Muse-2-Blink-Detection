"""Real Muse 2 acquisition via BrainFlow.

WHY BRAINFLOW: it is the most actively maintained, cross-platform, open-
source biosignal acquisition library with first-class Muse 2 support (BLE
under the hood via its own native board driver), used and maintained by a
large open-source community, rather than an old single-purpose Muse BLE
tutorial script. See docs/MUSE2_SETUP.md.

WAITING FOR HARDWARE VERIFICATION: this module is written against BrainFlow's
public Python API (BoardShim / BrainFlowInputParams / BoardIds.MUSE_2_BOARD)
as documented at https://brainflow.readthedocs.io/, but has not been
exercised against a physical Muse 2 in this environment (no device, no BLE
stack available here). Channel *names* are resolved dynamically via
`BoardShim.get_eeg_names(board_id)` rather than assumed by fixed index,
specifically so we do not have to guess Muse 2's electrode ordering. Verify
end-to-end on real hardware before trusting this for anything beyond bench
testing.
"""
from __future__ import annotations

from .base import EEGSource, Sample

try:
    from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
    from brainflow.data_filter import DataFilter

    _BRAINFLOW_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when brainflow isn't installed
    _BRAINFLOW_AVAILABLE = False


class BrainflowMuse2Source(EEGSource):
    def __init__(self, mac_address: str | None = None, serial_port: str | None = None):
        if not _BRAINFLOW_AVAILABLE:
            raise ImportError(
                "brainflow is not installed. Install the optional acquisition extra: "
                "pip install -e .[acquisition]  (see docs/MUSE2_SETUP.md)"
            )
        self.params = BrainFlowInputParams()
        if mac_address:
            self.params.mac_address = mac_address
        if serial_port:
            self.params.serial_port = serial_port

        self.board_id = BoardIds.MUSE_2_BOARD
        self.board = BoardShim(self.board_id, self.params)

        self._eeg_names = BoardShim.get_eeg_names(self.board_id)
        self._eeg_channels = BoardShim.get_eeg_channels(self.board_id)
        self._name_to_channel_idx = dict(zip(self._eeg_names, self._eeg_channels))
        self._fs_hz = float(BoardShim.get_sampling_rate(self.board_id))

        self._timestamp_channel = BoardShim.get_timestamp_channel(self.board_id)
        self._accel_channels = None
        try:
            self._accel_channels = BoardShim.get_accel_channels(self.board_id)
        except Exception:
            self._accel_channels = None

        self._started = False

    def start(self) -> None:
        self.board.prepare_session()
        self.board.start_stream()
        self._started = True

    def stop(self) -> None:
        if self._started:
            self.board.stop_stream()
            self.board.release_session()
            self._started = False

    @property
    def sample_rate_hz(self) -> float:
        return self._fs_hz

    @property
    def has_imu(self) -> bool:
        return bool(self._accel_channels)

    def _channel_index(self, name: str) -> int | None:
        for candidate in (name, name.upper(), name.lower()):
            if candidate in self._name_to_channel_idx:
                return self._name_to_channel_idx[candidate]
        return None

    def read_samples(self) -> list[Sample]:
        if not self._started:
            return []
        data = self.board.get_board_data()  # pulls & clears the internal ring buffer
        if data.shape[1] == 0:
            return []

        af7_idx = self._channel_index("AF7")
        af8_idx = self._channel_index("AF8")
        tp9_idx = self._channel_index("TP9")
        tp10_idx = self._channel_index("TP10")

        n = data.shape[1]
        out: list[Sample] = []
        for i in range(n):
            ax = ay = az = None
            if self._accel_channels:
                try:
                    ax = float(data[self._accel_channels[0], i])
                    ay = float(data[self._accel_channels[1], i])
                    az = float(data[self._accel_channels[2], i])
                except (IndexError, ValueError):
                    ax = ay = az = None
            out.append(
                Sample(
                    timestamp_s=float(data[self._timestamp_channel, i]),
                    af7=float(data[af7_idx, i]) if af7_idx is not None else 0.0,
                    af8=float(data[af8_idx, i]) if af8_idx is not None else 0.0,
                    tp9=float(data[tp9_idx, i]) if tp9_idx is not None else 0.0,
                    tp10=float(data[tp10_idx, i]) if tp10_idx is not None else 0.0,
                    accel_x=ax,
                    accel_y=ay,
                    accel_z=az,
                )
            )
        return out
