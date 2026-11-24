import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { version } from "../package.json";
import { api } from "./api";
const upstream = "https://github.com/tannerwj/edge-mail";
const schema = z.object({
  status: z.enum(["update", "current", "unpublished", "unavailable"]),
  latest: z.optional(z.string()),
});
export function VersionSettings() {
  const [on, setOn] = useState(localStorage.getItem("edge-mail-update-checks") === "on");
  const result = useQuery({
    queryKey: ["release-status"],
    queryFn: () => api("release-status").then((v) => schema.parse(v)),
    enabled: on,
    staleTime: 86400000,
  });
  return (
    <section aria-label="About Edge Mail">
      <h2>About Edge Mail</h2>
      <p>Version {version}</p>
      <label>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            localStorage.setItem("edge-mail-update-checks", e.target.checked ? "on" : "off");
          }}
        />{" "}
        Check for new releases on this device
      </label>
      {on && (
        <p role="status">
          {result.data?.status === "update" ? (
            <a href={upstream + "/releases"} target="_blank" rel="noreferrer">
              Version {result.data.latest} is available. Read the upgrade notes.
            </a>
          ) : result.data?.status === "unpublished" ? (
            "No public release is available yet."
          ) : result.data?.status === "current" ? (
            "You have the latest stable release."
          ) : result.isFetching ? (
            "Checking releases…"
          ) : (
            "Release information is unavailable."
          )}
        </p>
      )}
      <a
        href={upstream + "/issues/new?template=feedback.yml&version=" + encodeURIComponent(version)}
        target="_blank"
        rel="noreferrer"
      >
        Give project feedback
      </a>
    </section>
  );
}
