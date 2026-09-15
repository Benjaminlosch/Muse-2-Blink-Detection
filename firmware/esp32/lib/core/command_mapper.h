// Blink-event -> hand command mapping — port of
// classification/command_mapper.py / web/src/core/classification/commandMapper.ts.
// Reuses safety_state_machine.h's Command enum (kHold/kOpen/kClose) rather
// than redefining it.
#pragma once

#include "safety_state_machine.h"

namespace bcihand {

class HandStateTracker {
 public:
  Command lastCommanded() const { return lastCommanded_; }
  bool hasLastCommanded() const { return hasLastCommanded_; }

  Command toggle() {
    Command next = (hasLastCommanded_ && lastCommanded_ == Command::kOpen) ? Command::kClose : Command::kOpen;
    lastCommanded_ = next;
    hasLastCommanded_ = true;
    return next;
  }

  void setLastCommanded(Command c) {
    lastCommanded_ = c;
    hasLastCommanded_ = true;
  }

  void reset() { hasLastCommanded_ = false; }

 private:
  Command lastCommanded_ = Command::kHold;
  bool hasLastCommanded_ = false;
};

enum class MappedIntent { kToggleOpenClose, kOpen, kClose, kHold };

Command resolveCommandMapping(MappedIntent intent, HandStateTracker& handState);

}  // namespace bcihand
