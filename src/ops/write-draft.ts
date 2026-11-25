import { moveDraft } from "./move-draft";
import { discardAction } from "./compose-undo";
import { saveDraft } from "./drafts";
import type { Bindings } from "../env";
import type { User } from "./access";
export function writeMailboxDraft(
  env: Bindings,
  user: User,
  box: string,
  id: string | undefined,
  data: Record<string, unknown>,
) {
  if (id && data.action === "move") return moveDraft(env, user, box, id, data);
  if (id && (data.action === "discard" || data.action === "restore"))
    return discardAction(env, user, box, id, data);
  return saveDraft(env, user, box, id, data);
}
