import { useLayoutEffect, useState } from "react";
import * as z from "zod/mini";

const point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof point>;
const identifier = z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/));
const windowSchema = z.object({
  box: identifier,
  id: identifier,
  layout: z.enum(["pinned", "floating"]),
  wide: z.boolean(),
  position: z.optional(point),
});
export type DraftWindow = z.infer<typeof windowSchema>;
export type DraftRef = Pick<DraftWindow, "box" | "id">;
const session = z.object({ windows: z.array(windowSchema), active: z.nullable(identifier) });
type Desk = z.infer<typeof session>;
const empty: Desk = { windows: [], active: null };

function read(key: string): Desk {
  try {
    return session.parse(JSON.parse(sessionStorage.getItem(key) || "null"));
  } catch {
    return empty;
  }
}
export function useComposeSession(user: string, route?: DraftRef) {
  const key = "edge-mail-compose-v1:" + user;
  const [desk, setDesk] = useState(() => read(key));
  const [previousRoute, setPreviousRoute] = useState<string>();
  if (route?.id !== previousRoute) {
    setPreviousRoute(route?.id);
    if (route) {
      const exists = desk.windows.some((w) => w.id === route.id);
      const windows: DraftWindow[] = exists
        ? desk.windows
        : [...desk.windows, { ...route, layout: "pinned", wide: false }];
      setDesk({ windows, active: route.id });
    }
  }
  useLayoutEffect(() => {
    try {
      if (desk.windows.length) sessionStorage.setItem(key, JSON.stringify(desk));
      else sessionStorage.removeItem(key);
    } catch {
      // The desk still works in memory when browser storage is unavailable.
    }
  }, [key, desk]);
  function change(
    id: string,
    values: Partial<Pick<DraftWindow, "layout" | "wide" | "position" | "id" | "box">>,
  ) {
    setDesk((current) => ({
      ...current,
      active: current.active === id && values.id ? values.id : current.active,
      windows: current.windows.map((w) => (w.id === id ? { ...w, ...values } : w)),
    }));
  }
  function activate(active: string | null) {
    setDesk((current) => ({ ...current, active }));
  }
  function remove(id: string) {
    setDesk((current) => ({
      windows: current.windows.filter((w) => w.id !== id),
      active: current.active === id ? null : current.active,
    }));
  }
  return { desk, change, activate, remove };
}
