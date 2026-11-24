import { useState } from "react";
import type { Workspace } from "./api";
import { useQueryClient } from "@tanstack/react-query";
import { importArchive, exportArchive } from "./archive-transfer";
export function Portability({ space }: { space: Workspace }) {
  const boxes = space.mailboxes.filter((b) => b.can_forward);
  const [box, setBox] = useState(boxes[0]?.id || ""),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const client = useQueryClient();
  if (!boxes.length) return null;
  async function process(mode: "import" | "mbox" | "zip") {
    const selected = boxes.find((b) => b.id === box);
    if (busy || !selected) return;
    setBusy(true);
    setStatus("Preparing archive…");
    let count = 0;
    const progress = (n: number) => {
      count = n;
      setStatus(n + " messages processed…");
    };
    try {
      if (mode === "import" && file) {
        await importArchive(box, file, progress);
        await client.invalidateQueries({ queryKey: ["inbox", box] });
      } else if (mode !== "import") await exportArchive(box, selected.address, mode, progress);
      setStatus(
        (mode === "import" ? "Import complete" : "Export complete") + " · " + count + " messages",
      );
    } catch (e) {
      setStatus(
        (e instanceof Error ? e.message : "Transfer interrupted") +
          " · " +
          count +
          " messages processed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Import and export mail</summary>
      <fieldset disabled={busy}>
        <legend>Mailbox archive</legend>
        <label>
          Archive mailbox
          <select value={box} onChange={(e) => setBox(e.target.value)}>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.address}
              </option>
            ))}
          </select>
        </label>
        <label>
          Import an mbox file
          <input type="file" onChange={(e) => setFile(e.target.files?.[0])} />
        </label>
        <p>
          Imported mail becomes searchable. Repeating an import skips messages already stored.
          Historical mail never triggers forwarding or vacation replies.
        </p>
        <button disabled={!file} onClick={() => void process("import")}>
          Import messages
        </button>
        <button onClick={() => void process("mbox")}>Export mbox</button>
        <button onClick={() => void process("zip")}>
          Export originals, labels and rules (.zip)
        </button>
      </fieldset>
      <p role="status">{status}</p>
    </details>
  );
}
