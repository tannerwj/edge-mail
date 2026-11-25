import { useState } from "react";
export function CatalogSetup({ worker, refresh }: { worker?: string; refresh: () => void }) {
  const [status, setStatus] = useState("");
  const host = location.hostname,
    installed =
      worker || (/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(host) ? host.split(".")[0] : "");
  const command = "pnpm domains:sync --apply " + (installed || "--host " + host);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("Copied");
    } catch {
      setStatus("Select the command to copy it.");
    }
  }
  return (
    <section>
      <p>Run this from the checkout for this installation, then refresh the list.</p>
      <code>{command}</code>
      <button type="button" onClick={() => void copy()}>
        Copy command
      </button>
      <button type="button" onClick={refresh}>
        Refresh list
      </button>
      <p role="status">{status}</p>
      <a
        href="#manual-domain"
        onClick={(e) => {
          e.preventDefault();
          document.querySelector<HTMLInputElement>("#manual-domain input")?.focus();
        }}
      >
        Add a domain manually
      </a>
    </section>
  );
}
