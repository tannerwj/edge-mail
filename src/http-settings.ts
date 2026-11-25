import { combinedWork } from "./ops/combined-work";
import { unifiedInbox, searchBookmarks } from "./ops/search-bookmarks";
import { personErasure } from "./person-erasure";
import { releaseStatus } from "./upstream";
import { operatingLimits } from "./ops/budgets";
import { suppressionList } from "./ops/suppressions";
import { unknownRecipients } from "./ops/disposable";
import { reviews, reviewDetails } from "./ops/approvals";
import { people } from "./ops/people";
import { pushSettings } from "./ops/push";
import { notices } from "./ops/notices";
import { availableDomains } from "./ops/domain-import";
import { domainStatus } from "./ops/domain-status";
import { myGrants } from "./agents/grants";
import { operations } from "./ops/operations";
import { type Bindings, Problem } from "./env";
import { type User } from "./ops/access";
import { workspace } from "./ops/mailboxes";
export function readSettings(env: Bindings, user: User, url: URL) {
  const [, , area, box, action, id] = url.pathname.split("/");
  if (area === "domains" && box && action === "unknown-recipients")
    return unknownRecipients(env, user, box);
  if (area === "domains" && box && action === "dns" && !id) return domainStatus(env, user, box);
  if (area === "approvals" && !action)
    return box ? reviewDetails(env, user, box) : reviews(env, user);
  return readNamedSetting(env, user, url);
}
function readNamedSetting(env: Bindings, user: User, url: URL) {
  switch (url.pathname) {
    case "/api/users/erasure":
      return personErasure(env, user);
    case "/api/limits":
      return operatingLimits(env, user);
    case "/api/release-status":
      return releaseStatus();
    case "/api/suppressions":
      return suppressionList(env, user, url);
    case "/api/workspace":
      return workspace(env, user);
    case "/api/domains/available":
      return availableDomains(env, user);
    case "/api/notifications":
      return pushSettings(env, user);
    case "/api/notices":
      return notices(env, user);
    case "/api/grants":
      return myGrants(env, user);
    case "/api/inboxes/drafts":
    case "/api/inboxes/scheduled":
      return combinedWork(
        env,
        user,
        url.pathname.endsWith("/drafts"),
        url.searchParams.get("before"),
      );
    case "/api/inbox":
      return unifiedInbox(env, user, url);
    case "/api/searches":
      return searchBookmarks(env, user, url.searchParams.get("box"));
    case "/api/operations":
      return operations(env, user);
    case "/api/users":
      return people(env, user);
    default:
      throw new Problem(404, "Unknown operation");
  }
}
