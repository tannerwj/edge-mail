import { Sidebar } from "./sidebar";
import { Inbox } from "./inbox";
import { Approvals } from "./approvals";
import { TriageNotice } from "./triage-notice";
import { DomainSetup } from "./domain-setup";
import { Status } from "./mail-display";
import { ChangeNotices } from "./notifications";
import { Consent } from "./consent";
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Link,
  Navigate,
  useLocation,
} from "@tanstack/react-router";
import "./style.css";
import { useLive } from "./live";
import { guardOffline } from "./offline";
import { api, type Box, type Session, type Workspace, sessionSchema, spaceSchema } from "./api";
const Settings = React.lazy(() => import("./settings").then((m) => ({ default: m.Settings })));
const Setup = React.lazy(() => import("./settings").then((m) => ({ default: m.Setup })));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
import { Outbox } from "./outbox";
import { Drafts } from "./drafts";
import { ComposeDesk } from "./compose-desk";
import {
  useMailLocation,
  destination,
  draftRoute,
  allMessageRoute,
  domainMessageRoute,
  combinedSearchRoutes,
  searchRoute,
  searchMessageRoute,
  folderRoute,
  messageRoute,
  type MailView,
} from "./navigation";
document.documentElement.dataset.color = localStorage.getItem("edge-mail-color") || "system";
const theme = localStorage.getItem("edge-mail-layout");
if (theme === "compact") document.documentElement.dataset.theme = theme;
function workspaceBox(space: Workspace | undefined, background: MailView) {
  const scope = space?.mailboxes.filter(
    (b) => !background.domain || b.domain_id === background.domain,
  );
  return background.box
    ? scope?.find((b) => b.id === background.box)
    : (background.view === "unified" && scope?.find((b) => b.can_edit)) || scope?.[0];
}
function Desk({ session }: { session: Session }) {
  const { entry, location, legacySearch } = useMailLocation();
  const q = useQuery({
    queryKey: ["workspace"],
    refetchInterval: (query) => ((query.state.data?.mailboxes.length ?? 0) > 1 ? 15000 : false),
    queryFn: () => api("workspace").then((v) => spaceSchema.parse(v)),
  });
  const space = q.data;
  const behind = useLocation({ select: (l) => l.state.composeBehind });
  const background = location.draft ? behind || { box: location.box, folder: "drafts" } : location;
  const box = workspaceBox(space, background);
  useLive(box?.id);
  if (!space) return <Status error={q.error} />;
  if (entry && location.view === "settings") return <Navigate to="/settings" replace />;
  const selectedBox = location.box || box?.id;
  if ((entry || legacySearch) && selectedBox)
    return <Navigate {...destination({ ...location, box: selectedBox })} replace />;

  return (
    <>
      <MailWorkspace session={session} space={space} box={box} location={background} />
      <TriageNotice />
      <ComposeDesk
        key={session.email}
        user={session.email}
        boxes={space.mailboxes}
        route={
          location.draft && location.box ? { id: location.draft, box: location.box } : undefined
        }
      />
    </>
  );
}
function EmptyWorkspace({ space, unavailable }: { space: Workspace; unavailable: boolean }) {
  const hasDomain = space.domains.length > 0;
  const canSetUp = hasDomain || space.user.role !== "member";
  return (
    <section className="settings">
      <h1>{unavailable ? "Mailbox unavailable" : "No mailboxes yet"}</h1>
      {unavailable && space.mailboxes.length > 0 ? (
        <Link to="/inboxes">Back to all inboxes</Link>
      ) : canSetUp ? (
        <>
          <p>
            {hasDomain
              ? "Create a mailbox on a domain you manage."
              : "Add a receiving domain, then create your first mailbox."}
          </p>
          <Link to="/settings/$section" params={{ section: "mailboxes" }}>
            Set up a mailbox
          </Link>
        </>
      ) : (
        <p>Ask an owner to share a mailbox with you.</p>
      )}
    </section>
  );
}
function MailWorkspace({
  session,
  space,
  box,
  location,
}: {
  session: Session;
  space: Workspace;
  box?: Box;
  location: MailView;
}) {
  return (
    <div className="app">
      <Sidebar
        space={space}
        session={session}
        box={
          location.view === "unified" ? workspaceBox(space, { ...location, box: undefined }) : box
        }
        view={location}
      />
      <main>
        <ChangeNotices />
        {location.view === "domain-setup" ? (
          <section className="settings">
            <h1>Domain setup</h1>
            <nav aria-label="Breadcrumb" className="crumbs">
              <Link to="/settings">Settings</Link> /{" "}
              <Link to="/settings/$section" params={{ section: "mailboxes" }}>
                Mailboxes &amp; domains
              </Link>{" "}
              / <span>Domain setup</span>
            </nav>
            {space.domains.some((d) => d.id === location.domain) ? (
              <DomainSetup
                key={location.domain}
                domains={space.domains.filter((d) => d.id === location.domain)}
                mailboxes={space.managed}
                expanded
              />
            ) : (
              <p>Domain unavailable.</p>
            )}
          </section>
        ) : location.view === "approvals" ? (
          <section className="settings">
            <h1>Approvals</h1>
            <Approvals />
          </section>
        ) : location.view === "unified" && space.mailboxes.length > 0 ? (
          <Inbox
            key={JSON.stringify([location.domain, location.q])}
            space={space}
            box={box}
            view={location}
          />
        ) : location.view === "settings" ? (
          <React.Suspense fallback={<p role="status">Opening settings…</p>}>
            <Settings email={session.email} space={space} section={location.section} />
          </React.Suspense>
        ) : box && (location.folder === "outbox" || location.folder === "scheduled") ? (
          <Outbox box={box} scheduled={location.folder === "scheduled"} />
        ) : box && (location.draft || location.folder === "drafts") ? (
          <Drafts box={box} />
        ) : box ? (
          <Inbox
            key={JSON.stringify([box.id, location.folder, location.q])}
            space={space}
            box={box}
            view={location}
          />
        ) : (
          <EmptyWorkspace space={space} unavailable={!!location.box} />
        )}
      </main>
    </div>
  );
}
function App() {
  const q = useQuery({
    queryKey: ["session"],
    queryFn: () => api("session").then((v) => sessionSchema.parse(v)),
  });
  if (!q.data) return <Status error={q.error} />;
  if (q.data.setup)
    return (
      <React.Suspense fallback={<p role="status">Opening setup…</p>}>
        <Setup />
      </React.Suspense>
    );
  if (!q.data.role)
    return (
      <div className="standalone">
        <h1>No access</h1>
        <p>Ask the instance owner to add {q.data.email}.</p>
      </div>
    );
  return <Desk session={q.data} />;
}
const root = createRootRoute();
const mail = createRoute({ getParentRoute: () => root, id: "mail-workspace", component: App });
const routes = [
  "/",
  "/app",
  "/setup",
  "/settings",
  "/settings/$section",
  "/inboxes",
  "/approvals",
  "/domains/$domain/inbox",
  "/domains/$domain/setup",
  "/mailboxes/$box/drafts",
  searchRoute,
  searchMessageRoute,
  folderRoute,
  messageRoute,
  draftRoute,
  allMessageRoute,
  domainMessageRoute,
  ...combinedSearchRoutes,
].map((path) =>
  createRoute({
    getParentRoute: () => mail,
    path,
    validateSearch: (raw: Record<string, unknown>): MailView => ({
      draft: typeof raw.draft === "string" ? raw.draft : undefined,
      q: typeof raw.q === "string" ? raw.q : undefined,
      folder: typeof raw.folder === "string" ? raw.folder : undefined,
      box: typeof raw.box === "string" ? raw.box : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
      view: raw.view === "settings" ? "settings" : undefined,
    }),
  }),
);
const authorization = createRoute({
  getParentRoute: () => root,
  path: "/oauth/authorize",
  component: Consent,
});
const router = createRouter({
  routeTree: root.addChildren([mail.addChildren(routes), authorization]),
});
guardOffline();
const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
