import { SettingMatches, settingMatches } from "./setting-matches";
import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import {
  ChevronRight,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Inbox,
  Workflow,
  Users,
  Plug,
  Activity as Pulse,
  Archive,
  Info,
} from "lucide-react";
import { Form, type Field } from "./settings-form";
import { MailboxQuota } from "./mailbox-quota";
import { PersonErasure } from "./person-erasure";
import { ProjectFeedback } from "./project-feedback";
import { VersionSettings } from "./version";
import { ReceivingAddresses, UnknownRecipients } from "./disposable";
import { Approvals } from "./approvals";
import { People } from "./people";
import { Webhooks } from "./webhooks";
import { ErasureReceipts } from "./erasure";
import { Signatures } from "./identities";
import { NotificationSettings } from "./notifications";
import { Portability } from "./portability";
import { Activity } from "./activity";
import { Screening } from "./screening";
import { AgentSettings } from "./agents";
import { Rules } from "./rules";
import { Offboarding } from "./offboard";
import { useEffect, useState } from "react";
import { api, type Workspace } from "./api";

import { DomainImport } from "./domain-import";
import { DomainSetup } from "./domain-setup";
import { OfflineSettings } from "./offline";
import { AggregateReports } from "./reports";
import { OperatingLimits } from "./operating-limits";
import { Suppressions } from "./suppressions";
import { Operations } from "./operations";
import { Appearance } from "./triage";

export { Setup } from "./settings-form";
type Props = { space: Workspace };
function mailboxField(space: Workspace): Field {
  return {
    key: "box",
    label: "Mailbox",
    options: space.managed.map((b) => ({ value: b.id, label: b.address })),
  };
}
function MailboxSettings({ space }: Props) {
  const admin = space.user.role !== "member",
    box = mailboxField(space);
  return (
    <>
      {admin && <DomainImport />}
      {!!space.domains.length && <DomainSetup domains={space.domains} mailboxes={space.managed} />}
      <ReceivingAddresses space={space} />
      <UnknownRecipients space={space} />
      <div className="forms">
        {admin && (
          <div id="manual-domain">
            <Form
              title="Add domain"
              fields={[{ key: "name", label: "Domain name" }]}
              submit={(d) => api("domains", d)}
            />
          </div>
        )}
        {!!space.domains.length && (
          <Form
            title="Add mailbox"
            fields={[
              { key: "name", label: "Display name" },
              { key: "address", label: "Mailbox address", type: "email" },
            ]}
            submit={(d) => api("mailboxes", d)}
          />
        )}
        {!!space.managed.length && !!space.domains.length && (
          <Form
            title="Add alias"
            fields={[box, { key: "address", label: "Alias address", type: "email" }]}
            submit={(d) => api("mailboxes/" + d.box + "/aliases", d)}
          />
        )}
      </div>
    </>
  );
}
function AccessSettings({ space }: Props) {
  const admin = space.user.role !== "member",
    box = mailboxField(space);
  const login: Field = { key: "email", label: "Sign-in email", type: "email" };
  return (
    <>
      {admin && <People space={space} />}
      {admin && !!space.domains.length && (
        <Form
          title="Assign domain admin"
          fields={[
            {
              key: "domain",
              label: "Domain",
              options: space.domains.map((d) => ({ value: d.id, label: d.name })),
            },
            login,
          ]}
          submit={(d) => api("domains/" + d.domain + "/admins", d)}
        />
      )}
      {!!space.managed.length && (
        <Form
          title="Share mailbox"
          fields={[
            box,
            { key: "email", label: "User email", type: "email" },
            {
              key: "role",
              label: "Role",
              options: ["reader", "editor", "owner"].map((value) => ({ value, label: value })),
            },
          ]}
          submit={(d) => api("mailboxes/" + d.box + "/members", d)}
        />
      )}

      {admin && <Offboarding />}
      {space.user.role === "owner" && <PersonErasure />}
    </>
  );
}
function sections(space: Workspace, email: string) {
  const admin = space.user.role !== "member",
    owner = space.user.role === "owner",
    managed = !!space.managed.length;
  return [
    {
      id: "personal",
      title: "Preferences",
      summary: "Appearance, keyboard shortcuts, notifications and offline reading.",
      keywords: "theme color compact push device",
      icon: SlidersHorizontal,
      show: true,
      content: (
        <>
          <Appearance />
          <NotificationSettings />
          <OfflineSettings />
        </>
      ),
    },
    {
      id: "mailboxes",
      title: "Mailboxes & domains",
      summary: "Import domains, connect addresses and manage aliases.",
      keywords: "cloudflare receiving DNS MX disposable unknown recipients postmaster",
      icon: Inbox,
      show: admin || managed || !!space.domains.length,
      content: <MailboxSettings space={space} />,
    },
    {
      id: "mail",
      title: "Mail handling",
      summary: "Sending identities, signatures, rules and sender screening.",
      keywords: "forward destination vacation block spam allowlist filter automation",
      icon: Workflow,
      show: !!space.mailboxes.length,
      content: (
        <>
          <Signatures space={space} />
          <Rules mailboxes={space.mailboxes} />
          {managed && <Screening space={space} />}
        </>
      ),
    },
    {
      id: "people",
      title: "People & access",
      summary: "Invite people, share mailboxes and manage access.",
      keywords: "permissions member roles domain administrator offboarding erase person",
      icon: Users,
      show: admin || managed,
      content: <AccessSettings space={space} />,
    },
    {
      id: "integrations",
      title: "Agents & integrations",
      summary: "Connected agents, API tokens, approvals and webhooks.",
      keywords: "OAuth MCP audit activity grant",
      icon: Plug,
      show: true,
      content: (
        <>
          <AgentSettings space={space} />
          <Approvals />
          <Webhooks space={space} />
          {!!space.mailboxes.length && <Activity space={space} />}
        </>
      ),
    },
    {
      id: "data",
      title: "Mail data",
      summary: "Import or export mail and review deletion receipts.",
      keywords: "mbox archive portability backup erase",
      icon: Archive,
      show: !!space.mailboxes.length,
      content: (
        <>
          <Portability space={space} />
          <ErasureReceipts space={space} />
        </>
      ),
    },
    {
      id: "operations",
      title: "Delivery & operations",
      summary: "Delivery health, quotas, backups and domain reports.",
      keywords: "limits budgets alerts storage suppression DMARC aggregate restore",
      icon: Pulse,
      show: admin || managed,
      content: (
        <>
          {admin && <Operations />}
          {owner && managed && <MailboxQuota space={space} />}{" "}
          {admin && <OperatingLimits owner={owner} />} {admin && <Suppressions owner={owner} />}
          <AggregateReports space={space} />
        </>
      ),
    },
    {
      id: "feedback",
      title: "Project feedback",
      summary: "Report a problem, suggest an improvement or check a maintainer reply.",
      keywords: "bug question support idea",
      icon: MessageSquare,
      show: true,
      content: <ProjectFeedback key={email} email={email} />,
    },
    {
      id: "about",
      title: "About Edge Mail",
      summary: "Version, release updates and project feedback.",
      keywords: "upgrade support",
      icon: Info,
      show: true,
      content: <VersionSettings />,
    },
  ].filter((s) => s.show);
}
function useSettingFocus() {
  const hash = useLocation({ select: (l) => l.hash });
  useEffect(() => {
    if (!hash) return undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      const details = target.closest("details");
      if (details) details.open = true;
      const control = target.querySelector<HTMLElement>("input,select,textarea,summary");
      control?.focus();
      target.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);
}
export function Settings({
  space,
  section,
  email,
}: {
  space: Workspace;
  email: string;
  section?: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const pages = sections(space, email),
    current = pages.find((p) => p.id === section);
  useSettingFocus();
  if (section)
    return (
      <section className="settings settings-detail">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/settings">All settings</Link>
          <ChevronRight size={14} />
          <span aria-current="page">{current?.title || "Unavailable"}</span>
        </nav>
        <div className="settings-columns">
          <label className="settings-picker">
            Section
            <select
              value={current?.id || ""}
              onChange={(e) =>
                void navigate({ to: "/settings/$section", params: { section: e.target.value } })
              }
            >
              {!current && <option value="">Choose a section</option>}
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <nav className="settings-sections" aria-label="Settings sections">
            {pages.map((p) => (
              <Link
                key={p.id}
                to="/settings/$section"
                params={{ section: p.id }}
                aria-current={section === p.id ? "page" : undefined}
              >
                <p.icon size={16} />
                {p.title}
              </Link>
            ))}
          </nav>
          <div className="section-panel">
            <h1>{current?.title || "Section unavailable"}</h1>
            {current && (
              <>
                <p className="section-description">{current.summary}</p>
                <div className="settings-controls">{current.content}</div>
              </>
            )}
          </div>
        </div>
      </section>
    );
  const needle = query.trim().toLowerCase(),
    matches = pages.filter((p) =>
      (p.title + " " + p.summary + " " + p.keywords).toLowerCase().includes(needle),
    );
  const controls = settingMatches(needle, space);
  const library =
    !!needle &&
    ["contacts", "contact", "templates", "template", "address book"].includes(needle) &&
    space.mailboxes.some((b) => b.can_edit);
  return (
    <section className="settings settings-home">
      <h1>Settings</h1>
      <label className="settings-search">
        <Search size={18} />
        <input
          type="search"
          placeholder="Find a setting…"
          aria-label="Find a setting"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {(controls.length > 0 || library) && (
        <SettingMatches matches={controls} library={library} space={space} />
      )}
      <nav className="settings-directory" aria-label="Settings categories">
        {matches.map((p) => (
          <Link key={p.id} to="/settings/$section" params={{ section: p.id }}>
            <span className="category-icon">
              <p.icon size={20} />
            </span>
            <span>
              <strong>{p.title}</strong>
              <small>{p.summary}</small>
            </span>
            <ChevronRight size={15} />
          </Link>
        ))}
      </nav>
      {!matches.length && !controls.length && !library && (
        <p role="status">
          No settings match “{query}”.{" "}
          <button className="quiet" onClick={() => setQuery("")}>
            Clear search
          </button>
        </p>
      )}
    </section>
  );
}
