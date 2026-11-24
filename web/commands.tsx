import { Command } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

const commands = [
  ["j", "Next message"],
  ["k", "Previous message"],
  ["/", "Search mailbox"],
  ["c", "Compose"],
  ["r", "Reply"],
  ["a", "Reply all"],
  ["f", "Forward"],
  ["e", "Archive message"],
  ["#", "Move to Trash"],
] as const;
type Shortcut = (typeof commands)[number][0];
function target(key: Shortcut) {
  return document.querySelector<HTMLElement>('[data-shortcut="' + key + '"]:not(:disabled)');
}
function available(key: Shortcut) {
  if (key === "j" || key === "k") return !!document.querySelector(".message-row .item");
  return !!target(key);
}
function run(key: Shortcut, move: (direction: number) => void) {
  if (key === "j" || key === "k") {
    move(key === "j" ? 1 : -1);
  } else if (key === "/") target(key)?.focus();
  else target(key)?.click();
}
export function MailCommands({ move }: { move: (direction: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [choices, setChoices] = useState<readonly (typeof commands)[number][]>([]);
  const open = useCallback(() => {
    setChoices(commands.filter(([key]) => available(key)));
    setFilter("");
    setActive(0);
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
  }, []);
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        document.querySelector("dialog:modal") ||
        (event.target instanceof Element && event.target.closest("dialog"))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
        return;
      }
      if (
        localStorage.getItem("edge-mail-shortcuts") === "off" ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable], dialog"))
      )
        return;
      const command = commands.find(([key]) => key === event.key);
      if (!command || !available(command[0])) return;
      event.preventDefault();
      run(command[0], move);
    };
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, [open, move]);
  const matches = choices.filter(([, title]) => title.toLowerCase().includes(filter.toLowerCase()));
  function choose(key: Shortcut) {
    dialog.current?.close();
    run(key, move);
  }
  return (
    <>
      <button
        className="quiet"
        onClick={open}
        aria-label="Mailbox commands"
        title="Mailbox commands (⌘K or Ctrl+K)"
      >
        <Command size={15} />
      </button>
      <dialog ref={dialog} aria-label="Mailbox commands" className="command-dialog">
        <form method="dialog">
          <h2>Mailbox commands</h2>
          <button aria-label="Close commands">Close</button>
        </form>
        <input
          aria-label="Find a command"
          role="combobox"
          aria-expanded="true"
          aria-controls="mail-command-options"
          aria-autocomplete="list"
          aria-activedescendant={matches[active] ? "mail-command-" + active : undefined}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (matches.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setActive(
                (index) =>
                  (index + matches.length + (e.key === "ArrowDown" ? 1 : -1)) % matches.length,
              );
            }
            if (e.key === "Enter" && matches[active]) {
              e.preventDefault();
              choose(matches[active][0]);
            }
          }}
        />
        <div role="listbox" id="mail-command-options" aria-label="Commands">
          {matches.map(([key, title], i) => (
            <button
              type="button"
              key={key}
              role="option"
              id={"mail-command-" + i}
              aria-selected={active === i}
              tabIndex={-1}
              onClick={() => choose(key)}
            >
              {title}
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        {!matches.length && <p>No matching commands.</p>}
      </dialog>
    </>
  );
}
