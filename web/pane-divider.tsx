import { useState, type PointerEvent } from "react";
const widths = [28, 36, 44, 52, 60] as const;
export function useListWidth() {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("edge-mail-list-width"));
    return widths.find((w) => w === saved) ?? 36;
  });
  const choose = (n: number) => {
    const nearest = widths.reduce((a, b) => (Math.abs(n - a) < Math.abs(n - b) ? a : b));
    setWidth(nearest);
    localStorage.setItem("edge-mail-list-width", String(nearest));
  };
  function drag(e: PointerEvent<HTMLElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const parent = e.currentTarget.parentElement?.getBoundingClientRect();
    if (parent?.width) choose(((e.clientX - parent.left) / parent.width) * 100);
  }
  const divider = (
    <div
      role="separator"
      tabIndex={0}
      className="pane-divider"
      aria-label="Conversation list width"
      aria-controls="mail-conversations"
      aria-valuemin={28}
      aria-valuemax={60}
      aria-valuenow={width}
      aria-valuetext={width + " percent"}
      aria-orientation="vertical"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
      }}
      onPointerMove={drag}
      onPointerUp={(e) => {
        drag(e);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        const keys: Record<string, number> = {
          ArrowLeft: width - 8,
          ArrowRight: width + 8,
          Home: 28,
          End: 60,
        };
        if (e.key in keys) {
          e.preventDefault();
          choose(keys[e.key]);
        }
      }}
    />
  );
  return { width, divider };
}
