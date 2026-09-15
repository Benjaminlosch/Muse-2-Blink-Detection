"""Real-time-style debugging visualization (project brief section 17).

Builds a static matplotlib figure from a completed run's PipelineStepResult
list. This is PC-only debugging tooling, not part of the real-time control
path. It works identically whether the results came from simulated or real
Muse 2 data, since it only consumes BlinkPipeline's output.

The figure shows, top to bottom:
  1. Raw frontal signal (uV) with ground-truth event spans shaded, if provided.
  2. Filtered frontal signal, the adaptive threshold (+/-), and blink
     candidate markers (accepted vs. rejected-by-classifier).
  3. Classifier confidence at each accepted candidate, with the
     high/medium confidence thresholds drawn for reference.
  4. The resolved command over time (HOLD / OPEN / CLOSE) as a step plot,
     which is what actually matters for the hand.
"""
from __future__ import annotations

from typing import Sequence

import matplotlib

matplotlib.use("Agg")  # headless-safe; call plt.show() explicitly if a display exists
import matplotlib.pyplot as plt
import numpy as np

from ..classification.command_mapper import Command
from ..classification.state_machine import BlinkEventType
from ..pipeline import PipelineStepResult

COMMAND_ORDER = {Command.HOLD: 0, Command.CLOSE: 1, Command.OPEN: 2}


def build_debug_figure(
    results: Sequence[PipelineStepResult],
    raw_af7: Sequence[float] | None = None,
    raw_af8: Sequence[float] | None = None,
    ground_truth: Sequence[tuple[float, float, str]] | None = None,
    high_confidence_threshold: float = 0.80,
    medium_confidence_threshold: float = 0.55,
    title: str = "BlinkPipeline debug view",
) -> "plt.Figure":
    t = np.array([r.timestamp_s for r in results])
    filtered_frontal = np.array([r.frontal_signal for r in results])
    threshold = np.array([r.adaptive_threshold for r in results])

    fig, axes = plt.subplots(4, 1, figsize=(14, 10), sharex=True)
    fig.suptitle(title)

    ax_raw, ax_filtered, ax_confidence, ax_command = axes

    # --- 1. Raw signal + ground truth spans ---------------------------------
    if raw_af7 is not None and raw_af8 is not None:
        raw_frontal = (np.asarray(raw_af7) + np.asarray(raw_af8)) / 2.0
        ax_raw.plot(t, raw_frontal, linewidth=0.6, color="tab:gray", label="raw frontal_mean")
    ax_raw.set_ylabel("raw (uV)")
    ax_raw.legend(loc="upper right", fontsize=8)

    if ground_truth:
        palette = plt.get_cmap("tab20")
        label_colors: dict[str, tuple] = {}
        for start_s, end_s, label in ground_truth:
            if label not in label_colors:
                label_colors[label] = palette(len(label_colors) % 20)
            for ax in (ax_raw, ax_filtered):
                ax.axvspan(start_s, end_s, color=label_colors[label], alpha=0.25)
            ax_raw.text(start_s, ax_raw.get_ylim()[1] * 0.9 if ax_raw.get_ylim()[1] else 0, label,
                        fontsize=6, rotation=90, va="top")

    # --- 2. Filtered signal + threshold + candidate markers -----------------
    ax_filtered.plot(t, filtered_frontal, linewidth=0.8, color="tab:blue", label="filtered frontal_mean")
    ax_filtered.plot(t, threshold, linewidth=0.8, linestyle="--", color="tab:orange", label="adaptive threshold")
    ax_filtered.plot(t, -threshold, linewidth=0.8, linestyle="--", color="tab:orange")

    accepted_t, accepted_y = [], []
    rejected_t, rejected_y = [], []
    for r in results:
        if r.candidate is None:
            continue
        peak = float(np.max(np.abs(r.candidate.frontal_window))) * np.sign(
            r.candidate.frontal_window[int(np.argmax(np.abs(r.candidate.frontal_window)))]
        )
        if r.classification is not None and r.classification.is_valid_blink:
            accepted_t.append(r.timestamp_s)
            accepted_y.append(peak)
        else:
            rejected_t.append(r.timestamp_s)
            rejected_y.append(peak)

    ax_filtered.scatter(accepted_t, accepted_y, color="tab:green", marker="^", s=40, label="accepted candidate", zorder=5)
    ax_filtered.scatter(rejected_t, rejected_y, color="tab:red", marker="x", s=30, label="rejected candidate", zorder=5)
    ax_filtered.set_ylabel("filtered (uV)")
    ax_filtered.legend(loc="upper right", fontsize=8)

    # --- 3. Confidence -------------------------------------------------------
    conf_t = [r.timestamp_s for r in results if r.classification is not None]
    conf_y = [r.classification.confidence for r in results if r.classification is not None]
    ax_confidence.scatter(conf_t, conf_y, s=15, color="tab:purple", label="candidate confidence")
    ax_confidence.axhline(high_confidence_threshold, color="green", linestyle=":", linewidth=1, label="high threshold")
    ax_confidence.axhline(medium_confidence_threshold, color="orange", linestyle=":", linewidth=1, label="medium threshold")
    ax_confidence.set_ylim(-0.05, 1.05)
    ax_confidence.set_ylabel("confidence")
    ax_confidence.legend(loc="upper right", fontsize=8)

    # --- 4. Resolved command timeline -----------------------------------------
    command_levels = [COMMAND_ORDER[r.gate_decision.command] for r in results]
    ax_command.step(t, command_levels, where="post", color="black", linewidth=1.2)
    double_t = [r.timestamp_s for r in results if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED]
    for dt in double_t:
        ax_command.axvline(dt, color="tab:green", linestyle="--", linewidth=0.8, alpha=0.7)
    ax_command.set_yticks([0, 1, 2])
    ax_command.set_yticklabels(["HOLD", "CLOSE", "OPEN"])
    ax_command.set_ylabel("command")
    ax_command.set_xlabel("time (s)")

    fig.tight_layout()
    return fig


def save_debug_figure(fig: "plt.Figure", path: str) -> None:
    fig.savefig(path, dpi=150)
