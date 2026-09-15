// Confidence / safety gate — port of classification/confidence_gate.py /
// web/src/core/classification/confidenceGate.ts. HOLD is the fail-safe
// default. See docs/SAFETY.md.
#pragma once

#include "blink_state_machine.h"
#include "command_mapper.h"

namespace bcihand {

enum class ConfidenceLevel { kHigh, kMedium, kLow, kNone };

enum class GateReason {
  kCommunicationLost,
  kPoorSignalQuality,
  kNoEvent,
  kSingleBlinkUnmapped,
  kSingleBlinkMapped,
  kMediumConfidence,
  kLowConfidence,
  kDoubleBlinkConfirmedHighConfidence,
  kUnhandledEventType,
};

struct GateDecision {
  Command command;
  ConfidenceLevel confidenceLevel;
  GateReason reason;
};

ConfidenceLevel classifyConfidenceLevel(double confidence, double highThreshold, double mediumThreshold);

// hasEvent=false means "no event this cycle" (mirrors event=None in the
// Python/TS ports).
GateDecision gateEvent(bool hasEvent, const BlinkStateMachineEvent& event, bool signalQualityOk, bool commOk,
                         double highConfidenceThreshold, double mediumConfidenceThreshold,
                         MappedIntent doubleBlinkIntent, MappedIntent singleBlinkIntent, HandStateTracker& handState);

}  // namespace bcihand
