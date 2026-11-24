import { version } from "../package.json";

const stable = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/u;
function newer(release: string) {
  const left = stable.exec(release)?.slice(1).map(Number);
  const right = stable.exec(version)?.slice(1).map(Number);
  if (!left || !right) return false;
  const first = left.findIndex((n, i) => n !== right[i]);
  return first >= 0 && left[first] > right[first];
}
export async function releaseStatus() {
  // A single fixed upstream endpoint. Never forward the incoming request or Access headers.
  let response: Response;
  try {
    response = await fetch("https://api.github.com/repos/tannerwj/edge-mail/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "edge-mail-release-check" },
      redirect: "error",
      signal: AbortSignal.timeout(4000),
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 86400, "404": 3600 } },
    });
    if (response.status === 404) return { version, status: "unpublished" };
    if (response.ok) {
      const data = await response.json<{ tag_name?: string }>();
      if (typeof data.tag_name === "string" && stable.test(data.tag_name))
        return {
          version,
          latest: data.tag_name,
          status: newer(data.tag_name) ? "update" : "current",
        };
    }
  } catch {
    /* The mailbox stays available during an upstream outage. */
  }
  return { version, status: "unavailable" };
}
