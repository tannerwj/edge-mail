import { useState } from "react";
export function SearchFilters({ apply }: { apply: (terms: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="quick-filters" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Filters</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget),
            terms: string[] = [];
          for (const key of ["from", "to", "after", "before"]) {
            const entry = data.get(key);
            const v = typeof entry === "string" ? entry.trim() : "";
            if (v) terms.push(key + ':"' + v + '"');
          }
          if (data.has("attachment")) terms.push("has:attachment");
          if (terms.length) apply(terms.join(" "));
          setOpen(false);
        }}
      >
        {(
          [
            ["from", "Sender address"],
            ["to", "Recipient address"],
            ["after", "On or after"],
            ["before", "Before"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              type={key === "from" || key === "to" ? "text" : "date"}
              pattern={'[^"]*'}
            />
          </label>
        ))}
        <label>
          <input type="checkbox" name="attachment" />
          Has attachment
        </label>
        <button>Apply filters</button>
      </form>
    </details>
  );
}
