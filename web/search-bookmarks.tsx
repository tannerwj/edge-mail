import { Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
import { destination } from "./navigation";
const schema = z.object({
  searches: z.array(z.object({ query: z.string() })),
  labels: z.array(z.object({ label: z.string() })),
});
export function SearchBookmarks({ box, query }: { box: string; query?: string }) {
  const q = useQuery({
    queryKey: ["bookmarks", box],
    queryFn: async () => schema.parse(await api("searches?" + new URLSearchParams({ box }))),
  });
  const save = useMutation({
    mutationFn: (action: string) => api("searches", { box, query, action }),
    onSuccess: () => q.refetch(),
  });
  const exists = q.data?.searches.some((s) => s.query === query);
  return (
    <nav className="bookmarks" aria-label="Mail shortcuts">
      {!!q.data?.labels.length && (
        <details>
          <summary>Labels</summary>
          {q.data.labels
            .filter((l) => !l.label.includes('"'))
            .map((l) => (
              <Link key={l.label} {...destination({ box, q: 'label:"' + l.label + '"' })}>
                {l.label}
              </Link>
            ))}
        </details>
      )}
      {(!!q.data?.searches.length || query) && (
        <details open={!!query || undefined}>
          <summary>Saved searches</summary>
          {q.data?.searches.map((s) => (
            <Link key={s.query} {...destination({ box, q: s.query })}>
              {s.query}
            </Link>
          ))}
          {query && (
            <button
              disabled={save.isPending}
              onClick={() => save.mutate(exists ? "remove" : "save")}
            >
              {exists ? "Remove saved search" : "Save this search"}
            </button>
          )}
        </details>
      )}
      {save.error && <p role="alert">{save.error.message}</p>}
    </nav>
  );
}
