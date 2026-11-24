import { useLayoutEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { FilePenLine, Maximize2, Minimize2, Minus, Pin, PinOff, X } from "lucide-react";
import type { Point } from "./compose-session";
import type { WindowActions } from "./compose-desk";

const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-24, 0],
  ArrowRight: [24, 0],
  ArrowUp: [0, -24],
  ArrowDown: [0, 24],
};

function move(node: HTMLDialogElement, point: Point) {
  node.style.setProperty(
    "--compose-left",
    Math.max(0, Math.min(point.x, innerWidth - node.offsetWidth)) + "px",
  );
  node.style.setProperty(
    "--compose-top",
    Math.max(0, Math.min(point.y, innerHeight - node.offsetHeight)) + "px",
  );
  node.dataset.moved = "true";
}
function useMove({ move: remember, position, mode, wide }: WindowActions) {
  const dialog = useRef<HTMLDialogElement>(null);
  const offset = useRef<Point | undefined>(undefined);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (position && node && mode === "floating" && !wide) move(node, position);
  }, [dialog, position, mode, wide]);
  function start(e: PointerEvent<HTMLElement>) {
    const node = dialog.current;
    if (!node || !e.isPrimary || e.button !== 0 || !matchMedia("(min-width: 651px)").matches)
      return;
    const rect = node.getBoundingClientRect();
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function drag(e: PointerEvent<HTMLElement>) {
    if (e.isPrimary && offset.current && dialog.current)
      move(dialog.current, { x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  }
  function rememberPosition() {
    const rect = dialog.current?.getBoundingClientRect();
    if (rect) remember({ x: rect.left, y: rect.top });
  }
  function nudge(e: React.KeyboardEvent) {
    const step = arrows[e.key],
      node = dialog.current;
    if (!step || !node || !matchMedia("(min-width: 651px)").matches) return;
    e.preventDefault();
    const rect = node.getBoundingClientRect();
    move(node, { x: rect.x + step[0], y: rect.y + step[1] });
    rememberPosition();
  }
  return {
    dialog,
    nudge,
    start,
    drag,
    end: () => {
      if (offset.current) rememberPosition();
      offset.current = undefined;
    },
  };
}
function useWindowFocus(
  dialog: React.RefObject<HTMLDialogElement | null>,
  minimized: boolean,
  pinned: boolean,
  wide: boolean,
) {
  const lastFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node || minimized) return undefined;
    if (pinned) node.show();
    else node.showModal();
    const to = node.querySelector<HTMLInputElement>('input[aria-label="To"]');
    const body = node.querySelector<HTMLElement>("textarea, [contenteditable=true]");
    const last = lastFocusRef.current;
    (last && node.contains(last)
      ? last
      : (to?.value || node.querySelector(".recipient-chip")) && body
        ? body
        : to
    )?.focus({
      preventScroll: true,
    });
    const keepVisible = () => {
      if (node.dataset.moved && !wide && !pinned) {
        const rect = node.getBoundingClientRect();
        move(node, { x: rect.left, y: rect.top });
      }
    };
    const observer = new ResizeObserver(keepVisible);
    observer.observe(node);
    window.addEventListener("resize", keepVisible);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepVisible);
      node.close();
    };
  }, [dialog, minimized, pinned, wide]);
  return lastFocusRef;
}
type ComposeProps = {
  controls: WindowActions;
  close: () => void;
  subject?: string;
  children: ReactNode;
  save?: () => Promise<void>;
  send?: () => void;
};
export function ComposeWindow({ controls, close, subject, children, save, send }: ComposeProps) {
  const { mode, place, wide, expand } = controls;
  const { dialog, nudge, start, drag, end } = useMove(controls);

  const restore = useRef<HTMLButtonElement>(null);
  const minimized = mode === "minimized",
    pinned = mode === "pinned" && !wide;
  const movable = !pinned && !wide;
  const lastFocusRef = useWindowFocus(dialog, minimized, pinned, wide);
  async function minimize() {
    await save?.();
    place("minimized");
    requestAnimationFrame(() => restore.current?.focus());
  }
  return (
    <>
      {minimized && (
        <button
          className="compose-tab"
          ref={restore}
          onClick={controls.restore}
          aria-label={"Restore draft: " + (subject || "New message")}
          title={subject || "New message"}
        >
          <FilePenLine size={16} />
          <span>{subject || "New message"}</span>
          <Maximize2 size={14} />
        </button>
      )}
      <dialog
        ref={dialog}
        className="compose-window"
        data-mode={wide ? "expanded" : mode}
        aria-label="Compose"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onFocusCapture={(e) => {
          if (e.target.matches("input, textarea, [contenteditable=true]"))
            lastFocusRef.current = e.target;
        }}
        onKeyDownCapture={(e) => {
          if (e.nativeEvent.isComposing || e.repeat) return;
          if (pinned && e.key === "Escape") {
            e.preventDefault();
            close();
            return;
          }
          if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
          if (e.key === "Enter" || e.key.toLowerCase() === "s") {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Enter") send?.();
            else void save?.();
          }
        }}
      >
        <header>
          <div
            className="compose-handle"
            tabIndex={movable ? 0 : undefined}
            title={pinned ? "Unpin to move" : "Drag or use arrow keys to move"}
            onKeyDown={movable ? nudge : undefined}
            onPointerDown={movable ? start : undefined}
            onPointerMove={drag}
            onLostPointerCapture={end}
            onDoubleClick={() => expand(!wide)}
          >
            <FilePenLine size={16} />
            <h1>{subject || "New message"}</h1>
          </div>
          <div className="window-controls">
            <button
              type="button"
              aria-label="Minimize compose"
              title="Minimize"
              onClick={() => void minimize()}
            >
              <Minus />
            </button>
            <button
              type="button"
              aria-label={mode === "pinned" ? "Unpin compose" : "Pin compose to bottom"}
              title={mode === "pinned" ? "Unpin" : "Pin to bottom"}
              onClick={() => {
                place(mode === "pinned" ? "floating" : "pinned");
              }}
            >
              {mode === "pinned" ? <PinOff /> : <Pin />}
            </button>
            <button
              type="button"
              aria-label={wide ? "Restore compose size" : "Expand compose"}
              title={wide ? "Restore size" : "Expand"}
              onClick={() => expand(!wide)}
            >
              {wide ? <Minimize2 /> : <Maximize2 />}
            </button>
            <button type="button" aria-label="Close compose" title="Save and close" onClick={close}>
              <X />
            </button>
          </div>
        </header>
        {children}
      </dialog>
    </>
  );
}
