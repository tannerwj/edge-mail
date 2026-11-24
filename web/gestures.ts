import { useRef, type TouchEvent } from "react";

export function useMailGestures(refresh: () => void) {
  const start = useRef<{ x: number; y: number; reader: boolean; top: boolean } | null>(null);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const node = event.target;
      start.current = null;
      if (
        event.touches.length !== 1 ||
        !(node instanceof Element) ||
        node.closest("button,input,select,textarea,dialog,summary") ||
        !matchMedia("(max-width: 760px)").matches
      )
        return;
      const point = event.touches[0];
      start.current = {
        x: point.clientX,
        y: point.clientY,
        reader: !!node.closest(".reader"),
        top: window.scrollY <= 0,
      };
    },
    onTouchCancel() {
      start.current = null;
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const first = start.current;
      start.current = null;
      if (!first || event.touches.length || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - first.x,
        dy = event.changedTouches[0].clientY - first.y;
      if (first.reader && dx > 85 && Math.abs(dy) < 35)
        event.currentTarget.querySelector<HTMLAnchorElement>(".reader .back")?.click();
      if (!first.reader && first.top && dy > 90 && Math.abs(dx) < 35) refresh();
    },
  };
}
