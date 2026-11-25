import { undoSubmission } from "./compose-undo";
import { cancelSend, submitDraft } from "./outbox";
import type { User } from "./access";
import { type Bindings, Problem } from "../env";
export function outboxAction(
  env: Bindings,
  user: User,
  box: string,
  id: string,
  data: Record<string, unknown>,
) {
  if (data.action === "undo") return undoSubmission(env, user, box, id);
  if (data.action === "cancel") return cancelSend(env, user, box, id);
  if (data.action === "send") return submitDraft(env, user, box, id, data);
  throw new Problem(400, "Invalid outbox action");
}
