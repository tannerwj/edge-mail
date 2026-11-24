import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { X } from "lucide-react";
import { api } from "./api";
import type { Draft } from "./draft-state";

const fieldNames = ["to", "cc", "bcc"] as const;
const fields = { to: "To", cc: "Cc", bcc: "Bcc" } as const;
type Field = keyof typeof fields;
type Addresses = Pick<Draft["content"], Field>;
const contacts = z.object({
  contacts: z.array(z.object({ name: z.string(), address: z.string() })),
});
const list = (line: string) =>
  line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
function valid(value: string) {
  const [local, host, extra] = value.split("@");
  if (
    !local ||
    !host ||
    extra !== undefined ||
    /[\s<>(),:;"\\[\]\p{Cc}]/u.test(local) ||
    /(^\.|\.\.|\.$)/.test(local)
  )
    return false;
  if (!host.includes(".") || /[\s/@:#?%\\]/u.test(host)) return false;
  try {
    const domain = new URL("https://" + host).hostname,
      bytes = new TextEncoder();
    return (
      domain.length <= 253 &&
      domain.split(".").every((l) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(l)) &&
      bytes.encode(local).length <= 64 &&
      bytes.encode(local + "@" + domain).length <= 254
    );
  } catch {
    return false;
  }
}
export function recipientsReady(content: Addresses) {
  const all = [...list(content.to), ...list(content.cc), ...list(content.bcc)];
  return all.length > 0 && new Set(all.map((a) => a.toLowerCase())).size <= 50 && all.every(valid);
}
function clean(text: string) {
  return text
    .replace(/(?:"[^"]*"|[^,;\n<>]*)<([^<>]+)>/g, "$1")
    .split(/[,;\r\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}
type RowProps = {
  box: string;
  field: Field;
  value: string;
  edit: (v: string) => void;
  move: (from: Field, to: Field, value: string) => void;
};
function MoveButtons({ field, choose }: { field: Field; choose: (field: Field) => void }) {
  return fieldNames
    .filter((f) => f !== field)
    .map((f) => (
      <button type="button" key={f} onClick={() => choose(f)}>
        Move to {fields[f]}
      </button>
    ));
}
function RecipientRow({ box, field, value, edit, move }: RowProps) {
  const input = useRef<HTMLInputElement>(null),
    options = useId();
  const [typing, setTyping] = useState(false),
    [selected, select] = useState<number | null>(null);
  const parts = value.split(",");
  const pending = typing ? (parts.pop() || "").trimStart() : "";
  const chips = [...new Set(parts.map((v) => v.trim()).filter(Boolean))];
  const q = useQuery({
    queryKey: ["compose-contacts", box, pending],
    enabled: !!pending,
    queryFn: async () =>
      contacts.parse(
        await api("mailboxes/" + box + "/contacts?q=" + encodeURIComponent(pending.slice(0, 100))),
      ),
  });
  function commit(values: string[]) {
    edit([...new Set(values)].join(", "));
    setTyping(false);
    select(null);
  }
  function begin(i: number) {
    const tail = chips[i];
    edit([...chips.filter((_, index) => index !== i), tail].join(", "));
    setTyping(true);
    select(null);
    input.current?.focus();
  }
  return (
    <div className="recipient-row">
      <label htmlFor={options + "-input"}>{fields[field]}</label>
      <div className="recipient-values">
        {chips.map((v, i) => (
          <span className="recipient-entry" key={v}>
            <span className="recipient-chip" data-invalid={!valid(v) || undefined}>
              <button
                type="button"
                aria-label={"Options for " + v + " in " + fields[field]}
                aria-expanded={selected === i}
                onClick={() => select(selected === i ? null : i)}
              >
                {v}
              </button>
              <button
                type="button"
                aria-label={"Remove " + v + " from " + fields[field]}
                onClick={() => commit(chips.filter((_, n) => n !== i))}
              >
                <X size={12} />
              </button>
            </span>
            {selected === i && (
              <span className="recipient-options">
                <button type="button" onClick={() => begin(i)}>
                  Edit address
                </button>
                <MoveButtons
                  field={field}
                  choose={(f) => {
                    move(field, f, v);
                    select(null);
                  }}
                />
              </span>
            )}
          </span>
        ))}
        <input
          id={options + "-input"}
          ref={input}
          autoComplete="off"
          list={options}
          value={pending}
          maxLength={Math.max(0, 4096 - chips.join(", ").length)}
          aria-label={fields[field]}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]/.test(v)) commit([...chips, ...clean(v)]);
            else {
              setTyping(true);
              edit([...chips, v].join(", "));
            }
          }}
          onBlur={() => {
            if (typing) commit([...chips, ...clean(pending)]);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return;
            if (e.key === "Enter" && pending) {
              e.preventDefault();
              commit([...chips, ...clean(pending)]);
            }
            if (e.key === "Backspace" && !pending && chips.length) {
              e.preventDefault();
              begin(chips.length - 1);
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (/[,;\r\n<>]/.test(text)) {
              e.preventDefault();
              commit([...chips, ...clean(pending + text)]);
            }
          }}
        />
        <datalist id={options}>
          {q.data?.contacts.map((c) => (
            <option key={c.address} value={c.address}>
              {c.name}
            </option>
          ))}
        </datalist>
        {chips.some((v) => !valid(v)) && <small role="alert">Check the highlighted address.</small>}
      </div>
    </div>
  );
}
export function DraftRecipients({
  box,
  content,
  edit,
}: {
  box: string;
  content: Addresses;
  edit: (field: Field, value: string) => void;
}) {
  const [copies, setCopies] = useState(!!(content.cc || content.bcc));
  function move(from: Field, to: Field, value: string) {
    edit(
      from,
      list(content[from])
        .filter((v) => v !== value)
        .join(", "),
    );
    edit(to, [...new Set([...list(content[to]), value])].join(", "));
    setCopies(true);
  }
  function row(field: Field) {
    return (
      <RecipientRow
        box={box}
        field={field}
        value={content[field]}
        edit={(v) => edit(field, v)}
        move={move}
      />
    );
  }
  return (
    <>
      <div className="compose-to">
        {row("to")}
        <button
          type="button"
          className="quiet"
          aria-expanded={copies}
          onClick={() => setCopies(!copies)}
        >
          Cc / Bcc
        </button>
      </div>
      {copies && (
        <>
          {row("cc")}
          {row("bcc")}
        </>
      )}
    </>
  );
}
