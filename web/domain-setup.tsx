import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { Form } from "./settings-form";
import { api, type Workspace } from "./api";
const result = z.object({
  domain: z.string(),
  apex: z.optional(z.boolean()),
  worker: z.optional(z.string()),
  state: z.enum(["declines", "cutover", "cloudflare", "unused"]),
  mx: z.array(z.string()),
  spf: z.array(z.string()),
  dmarc: z.array(z.string()),
});
const instructions = {
  declines:
    "This domain publishes a null MX and explicitly declines mail. Plan the change before enabling delivery.",
  cutover:
    "This domain already has a mail destination. Save the existing DNS and keep the previous provider available before changing MX.",
  cloudflare:
    "Cloudflare already receives this domain’s mail. Check which rules own each address before making changes.",
  unused:
    "Public DNS has no explicit or implicit mail host. Create mailboxes and grants before enabling Email Routing.",
};
export function DomainSetup({
  domains,
  mailboxes,
  expanded = false,
}: {
  domains: { id: string; name: string }[];
  mailboxes: Workspace["managed"];
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded),
    [id, setId] = useState(domains[0]?.id || "");
  const report = useQuery({
    queryKey: ["domain-dns", id],
    enabled: open && !!id,
    queryFn: async () => result.parse(await api("domains/" + id + "/dns")),
    retry: false,
  });
  const client = useQueryClient();
  const standards = useMutation({
    mutationFn: async () =>
      z
        .object({ created: z.number(), addresses: z.array(z.string()) })
        .parse(await api("domains/" + id + "/standard-mailboxes", {})),
    onSuccess: () => client.invalidateQueries({ queryKey: ["workspace"] }),
  });
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Receiving domain setup</summary>
      <label>
        Receiving domain
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            standards.reset();
          }}
        >
          {domains.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {expanded && domains[0] && (
        <Form
          title="Create a mailbox"
          fields={[
            { key: "name", label: "Display name" },
            { key: "local", label: "Address before @" + domains[0].name },
          ]}
          submit={({ name, local }) =>
            api("mailboxes", { name, address: local.trim() + "@" + domains[0].name })
          }
        />
      )}
      <p>
        Create postmaster, abuse and DMARC mailboxes for this domain. Existing addresses keep their
        delivery and membership settings.
      </p>
      <button disabled={!id || standards.isPending} onClick={() => standards.mutate()}>
        Create standard mailboxes
      </button>
      {standards.data && (
        <p role="status">
          Created {standards.data.created} standard mailboxes. Checked{" "}
          {standards.data.addresses.join(", ")}.
        </p>
      )}
      {standards.error && <p role="alert">{standards.error.message}</p>}
      {report.isLoading && <p role="status">Checking public DNS…</p>}
      {report.error && <p role="alert">{report.error.message}</p>}
      {report.data && (
        <>
          <h3>Mail delivery for {report.data.domain}</h3>
          {!report.data.dmarc.length && (
            <p role="status">
              No DMARC record was found at this name. Check the parent policy and existing senders
              before enabling Email Sending, which may add a reject policy. Start with a monitoring
              policy using p=none and a rua address for aggregate reports.
            </p>
          )}
          <p>{instructions[report.data.state]}</p>
          {report.data.worker && ["cloudflare", "unused"].includes(report.data.state) && (
            <RecipientRoute
              key={id}
              domain={report.data.domain}
              worker={report.data.worker}
              mailboxes={mailboxes.filter((b) => b.domain_id === id)}
            />
          )}
          <dl>
            {(["mx", "spf", "dmarc"] as const).map((k) => (
              <React.Fragment key={k}>
                <dt>{k.toUpperCase()}</dt>
                <dd>
                  {report.data[k].length
                    ? report.data[k].map((v) => (
                        <div key={v}>
                          <code>{v}</code>
                        </div>
                      ))
                    : "None published at this name"}
                </dd>
              </React.Fragment>
            ))}
          </dl>
          <p>
            Run <code>pnpm domain:check {report.data.domain}</code> from the operator checkout to
            verify the zone, signing selector, routing rules and event subscription.
          </p>
        </>
      )}
      <button type="button" disabled={report.isFetching} onClick={() => void report.refetch()}>
        Refresh DNS
      </button>
    </details>
  );
}

function RecipientRoute({
  domain,
  worker,
  mailboxes,
}: {
  domain: string;
  worker: string;
  mailboxes: Workspace["managed"];
}) {
  const [selected, setSelected] = useState("");
  const address = mailboxes.find((b) => b.address === selected)?.address || mailboxes[0]?.address;
  if (!address) return <p>Create a mailbox to see its receiving route.</p>;
  const argument = "'" + address.replaceAll("'", "'\\''") + "'";
  return (
    <>
      <label>
        Address to connect
        <select value={address} onChange={(e) => setSelected(e.target.value)}>
          {mailboxes.map((b) => (
            <option key={b.id}>{b.address}</option>
          ))}
        </select>
      </label>
      <p>Preview routing for this address from your installation checkout.</p>
      <code>
        pnpm domain:connect --check {domain} {worker} --only {argument}
      </code>
      <p>
        Review the DNS and rule changes, then replace <code>--check</code> with <code>--apply</code>{" "}
        to connect it.
      </p>
    </>
  );
}
