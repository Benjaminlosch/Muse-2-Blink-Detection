#include "command_mapper.h"

namespace bcihand {

Command resolveCommandMapping(MappedIntent intent, HandStateTracker& handState) {
  switch (intent) {
    case MappedIntent::kToggleOpenClose:
      return handState.toggle();
    case MappedIntent::kOpen:
      handState.setLastCommanded(Command::kOpen);
      return Command::kOpen;
    case MappedIntent::kClose:
      handState.setLastCommanded(Command::kClose);
      return Command::kClose;
    case MappedIntent::kHold:
    default:
      return Command::kHold;
  }
}

}  // namespace bcihand
