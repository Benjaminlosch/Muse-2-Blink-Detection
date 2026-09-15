#include "confidence_gate.h"

namespace bcihand {

ConfidenceLevel classifyConfidenceLevel(double confidence, double highThreshold, double mediumThreshold) {
  if (confidence >= highThreshold) return ConfidenceLevel::kHigh;
  if (confidence >= mediumThreshold) return ConfidenceLevel::kMedium;
  return ConfidenceLevel::kLow;
}

GateDecision gateEvent(bool hasEvent, const BlinkStateMachineEvent& event, bool signalQualityOk, bool commOk,
                         double highConfidenceThreshold, double mediumConfidenceThreshold,
                         MappedIntent doubleBlinkIntent, MappedIntent singleBlinkIntent, HandStateTracker& handState) {
  if (!commOk) return {Command::kHold, ConfidenceLevel::kNone, GateReason::kCommunicationLost};
  if (!signalQualityOk) return {Command::kHold, ConfidenceLevel::kNone, GateReason::kPoorSignalQuality};
  if (!hasEvent) return {Command::kHold, ConfidenceLevel::kNone, GateReason::kNoEvent};

  ConfidenceLevel level = classifyConfidenceLevel(event.confidence, highConfidenceThreshold, mediumConfidenceThreshold);

  if (event.eventType == BlinkEventType::kSingleBlinkConfirmed) {
    Command cmd = resolveCommandMapping(singleBlinkIntent, handState);
    GateReason reason = (cmd == Command::kHold) ? GateReason::kSingleBlinkUnmapped : GateReason::kSingleBlinkMapped;
    return {cmd, level, reason};
  }

  if (event.eventType == BlinkEventType::kDoubleBlinkConfirmed) {
    if (level != ConfidenceLevel::kHigh) {
      GateReason reason = (level == ConfidenceLevel::kMedium) ? GateReason::kMediumConfidence : GateReason::kLowConfidence;
      return {Command::kHold, level, reason};
    }
    Command cmd = resolveCommandMapping(doubleBlinkIntent, handState);
    return {cmd, level, GateReason::kDoubleBlinkConfirmedHighConfidence};
  }

  return {Command::kHold, ConfidenceLevel::kNone, GateReason::kUnhandledEventType};
}

}  // namespace bcihand
