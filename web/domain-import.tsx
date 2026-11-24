import { Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";

const catalog = z.object({
  version: z.string(),
  updated: z.string(),
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      imported: z.boolean(),
      domain_id: z.optional(z.nullable(z.string())),
    }),
  ),
});

export function DomainImport() {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Import Cloudflare domains</summary>
      {open && <DomainPicker />}
    </details>
  );
}

function DomainPicker() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["available-domains"],
    queryFn: async () => catalog.parse(await api("domains/available")),
  });
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: async () =>
      z
        .object({ created: z.number(), existing: z.number() })
        .parse(await api("domains/import", { version: query.data?.version, zones: selected })),
    onSuccess: async () => {
      setSelected([]);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["available-domains"] }),
        client.invalidateQueries({ queryKey: ["workspace"] }),
      ]);
    },
  });
  if (!query.data)
    return <p role="status">{query.error?.message || "Loading Cloudflare domains…"}</p>;
  if (!query.data.version)
    return (
      <p>
        In your installation checkout, run <code>pnpm domains:sync --apply YOUR_WORKER</code> using
        the Worker name you chose when deploying. Then refresh this list.
        <button className="quiet" onClick={() => void query.refetch()}>
          Refresh list
        </button>
      </p>
    );
  const shown = query.data.zones.filter((zone) => zone.name.includes(filter.trim().toLowerCase()));
  return (
    <>
      <p>
        Choose domains to add to this instance. Mail delivery stays with its current provider until
        you configure routing.
      </p>
      <label>
        Find a domain
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <fieldset disabled={mutation.isPending}>
        <legend>Available domains</legend>
        {shown.map((zone) => (
          <label key={zone.id} className="zone-option">
            <input
              type="checkbox"
              disabled={zone.imported || (selected.length >= 50 && !selected.includes(zone.id))}
              checked={zone.imported || selected.includes(zone.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, zone.id]
                    : selected.filter((id) => id !== zone.id),
                )
              }
            />
            {zone.name}
            {zone.imported && <small>Already added</small>}
          </label>
        ))}
        {shown
          .filter((zone) => zone.imported && zone.domain_id)
          .map((zone) => (
            <p key={zone.id}>
              <Link to="/domains/$domain/setup" params={{ domain: zone.domain_id || "" }}>
                Set up {zone.name}
              </Link>
            </p>
          ))}
        {!shown.length && (
          <p>{filter ? "No matching domains." : "This account has no active zones."}</p>
        )}
      </fieldset>
      <button disabled={!selected.length || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? "Importing…" : "Import selected domains"}
        {selected.length > 0 && " (" + selected.length + ")"}
      </button>
      {mutation.data && (
        <p role="status">
          Added {mutation.data.created}. Already present {mutation.data.existing}.
        </p>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      <button
        className="quiet"
        onClick={() => {
          setSelected([]);
          void query.refetch();
        }}
      >
        Refresh list
      </button>
    </>
  );
}
