// Combines the Muse 2's four independently-notifying EEG characteristics
// (TP9, AF7, AF8, TP10) into aligned multi-channel samples. Ported from
// the same buffering strategy as web/src/muse/eegZipper.ts (itself ported
// from muse-js's zip-samples.ts): buffer readings that share the same
// group timestamp; once a reading with a new timestamp arrives, the
// previous group is complete and is flushed as N combined samples (N = 12
// on the Muse 2). Dependency-free (no NimBLE/BLE includes) so it's
// testable independent of the BLE stack.
#pragma once

namespace bcihand {

struct ZippedEegSample {
  double timestampMs;
  double tp9, af7, af8, tp10;
};

class EegZipper {
 public:
  static constexpr int kMaxSamplesPerNotification = 16;  // Muse sends 12; small margin

  // electrodeIndex: 0=TP9, 1=AF7, 2=AF8, 3=TP10. Calls onSample once for
  // each completed sample in a flushed group (0 or more times per call).
  // onSample receives a raw pointer + user context to avoid std::function
  // overhead on a tight embedded loop.
  template <typename Callback>
  void push(int electrodeIndex, double groupTimestampMs, const double* samples, int n, Callback onSample) {
    if (hasGroupTimestamp_ && groupTimestampMs != groupTimestampMs_) {
      flush(onSample);
    }
    groupTimestampMs_ = groupTimestampMs;
    hasGroupTimestamp_ = true;
    for (int i = 0; i < n && i < kMaxSamplesPerNotification; i++) buffers_[electrodeIndex][i] = samples[i];
    lengths_[electrodeIndex] = n;
    present_[electrodeIndex] = true;
  }

  void reset() {
    hasGroupTimestamp_ = false;
    for (int e = 0; e < 4; e++) present_[e] = false;
  }

 private:
  double buffers_[4][kMaxSamplesPerNotification];
  int lengths_[4] = {0, 0, 0, 0};
  bool present_[4] = {false, false, false, false};
  bool hasGroupTimestamp_ = false;
  double groupTimestampMs_ = 0.0;

  template <typename Callback>
  void flush(Callback onSample) {
    if (present_[0] && present_[1] && present_[2] && present_[3]) {
      int n = lengths_[0];  // all 4 electrodes report the same count per group in practice
      double msPerSample = 1000.0 / 256.0;
      for (int i = 0; i < n; i++) {
        ZippedEegSample s;
        s.timestampMs = groupTimestampMs_ + i * msPerSample;
        s.tp9 = buffers_[0][i];
        s.af7 = buffers_[1][i];
        s.af8 = buffers_[2][i];
        s.tp10 = buffers_[3][i];
        onSample(s);
      }
    }
    for (int e = 0; e < 4; e++) present_[e] = false;
  }
};

}  // namespace bcihand
