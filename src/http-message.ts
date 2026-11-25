import { conversationClaim } from "./ops/conversation-claim";
import { archiveConversation } from "./ops/workspace-triage";
import { triage } from "./ops/triage";
import { Problem, type Bindings } from "./env";
import type { User } from "./ops/access";
import { eraseMessage } from "./ops/erasure";
import { leaveList } from "./ops/list-unsubscribe";
export function messageWrite(
  env: Bindings,
  user: User,
  box: string,
  action: string,
  id: string,
  data: Record<string, unknown>,
) {
  if (action === "archive-thread") return archiveConversation(env, user, box, id);
  if (action === "claims") return conversationClaim(env, user, box, id, data.action);
  if (action === "messages") return triage(env, user, box, [id], data);
  if (["erase", "unsubscribe"].includes(action))
    return action === "erase"
      ? eraseMessage(env, user, box, id, data.confirm)
      : leaveList(env, user.id, box, id, data.confirm);

  throw new Problem(404, "Unknown mailbox operation");
}
