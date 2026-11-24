import { Paperclip } from "lucide-react";
import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import * as z from "zod/mini";

export const fileEntry = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  calendar: z.optional(z.literal("reply")),
  inline: z.optional(z.enum(["image/png", "image/jpeg", "image/gif"])),
});
type Entry = z.infer<typeof fileEntry>;
function imageType(name: string) {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  return undefined;
}
export async function uploadDraftFile(box: string, draft: string, file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const id = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const response = await fetch("/api/mailboxes/" + box + "/drafts/" + draft + "/" + id, {
    method: "PUT",
    redirect: "manual",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!response.ok)
    throw Error(
      "Could not attach " + file.name + ". Reopen the draft if your sign-in has expired.",
    );
  return { id, name: file.name, size: file.size };
}
function useFileEvents(
  fieldset: React.RefObject<HTMLFieldSetElement | null>,
  attach: (chosen: File[], pasted?: boolean) => Promise<void>,
) {
  const dropFiles = useEffectEvent((chosen: File[], pasted = false) => void attach(chosen, pasted));
  useEffect(() => {
    const dialog = fieldset.current?.closest("dialog");
    if (!dialog) return undefined;
    function handle(event: DragEvent) {
      const data = event.dataTransfer;
      if (!data?.types.includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      data.dropEffect = "copy";
      if (event.type === "drop") dropFiles(Array.from(data.files));
    }
    function paste(event: ClipboardEvent) {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("textarea,[contenteditable=true]")
      )
        return;
      const images = Array.from(event.clipboardData?.files || []).filter((f) =>
        ["image/png", "image/jpeg", "image/gif"].includes(f.type),
      );
      if (!images.length) return;
      event.preventDefault();
      event.stopPropagation();
      dropFiles(
        images.map((f) =>
          imageType(f.name) === f.type
            ? f
            : new File([f], "screenshot." + f.type.slice(6), { type: f.type }),
        ),
        true,
      );
    }
    dialog.addEventListener("paste", paste, true);
    dialog.addEventListener("dragover", handle, true);
    dialog.addEventListener("drop", handle, true);
    return () => {
      dialog.removeEventListener("paste", paste, true);
      dialog.removeEventListener("dragover", handle, true);
      dialog.removeEventListener("drop", handle, true);
    };
  }, [fieldset]);
}
export function ComposeFiles({
  box,
  draft,
  files,
  busy,
  uploading,
  update,
}: {
  box: string;
  draft: string;
  files: Entry[];
  busy: boolean;
  uploading: (value: boolean) => void;
  update: (value: Entry[]) => void;
}) {
  const [status, setStatus] = useState("");
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const pending = useRef(false);
  async function attach(chosen: File[], pasted = false) {
    if (!chosen.length || busy || pending.current) return;
    pending.current = true;
    uploading(true);
    const next = [...files];
    try {
      if (next.length + chosen.length > 32) throw Error("A message can include up to 32 files.");
      for (const file of chosen) {
        if (file.size > (25 * 1024 * 1024 * 3) / 4)
          throw Error("The encoded message exceeds 25 MiB.");
        if (file.name.length > 180 || /[/\\\p{Cc}\p{Cf}]/u.test(file.name))
          throw Error("Rename the file using a shorter, printable filename.");
        setStatus("Attaching " + file.name + "…");
        const { id } = await uploadDraftFile(box, draft, file);
        if (!next.some((entry) => entry.id === id && entry.name === file.name))
          next.push({
            id,
            name: file.name,
            size: file.size,
            ...(pasted ? { inline: imageType(file.name) } : {}),
          });
      }
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      if (next.length !== files.length) update(next);
      pending.current = false;
      uploading(false);
    }
  }
  useFileEvents(fieldset, attach);
  return (
    <fieldset ref={fieldset} disabled={busy}>
      <legend>Attachments</legend>
      <label className="attach-control" title="Choose files or drop them into this draft">
        <Paperclip size={16} /> Add files
        <input
          type="file"
          multiple
          onChange={(event) => {
            const chosen = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = "";
            void attach(chosen);
          }}
        />
      </label>
      {files.map((file, index) => (
        <div className="draft-attachment" key={file.id + file.name}>
          <span>
            {file.name} <small>{file.size.toLocaleString()} bytes</small>
          </span>
          {imageType(file.name) && (
            <label>
              <input
                type="checkbox"
                checked={!!file.inline}
                onChange={(e) =>
                  update(
                    files.map((f, i) =>
                      i === index
                        ? { ...f, inline: e.target.checked ? imageType(f.name) : undefined }
                        : f,
                    ),
                  )
                }
              />{" "}
              Embed {file.name} in the message
            </label>
          )}
          <button
            className="quiet"
            type="button"
            aria-label={"Remove " + file.name}
            onClick={() => update(files.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      {status && <p role="status">{status}</p>}
    </fieldset>
  );
}
