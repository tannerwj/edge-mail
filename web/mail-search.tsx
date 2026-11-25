import { Search } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { parseSearch } from "../src/search";
import type { Box } from "./api";
import { destination, type MailView } from "./navigation";
import { SearchFilters } from "./search-filters";
function FilterChips({ box, q, view }: { box: string; q: string; view: MailView }) {
  const tokens: string[] = [];
  try {
    parseSearch(q, 0, tokens);
  } catch {
    return null;
  }
  return (
    <nav className="search-chips" aria-label="Active search filters">
      {[...new Set(tokens)].map((t) => (
        <Link
          key={t}
          aria-label={"Remove filter " + t}
          {...destination({
            ...view,
            box,
            message: undefined,
            q: tokens.filter((v) => v !== t).join(" ") || undefined,
          })}
        >
          {t} ×
        </Link>
      ))}
    </nav>
  );
}
export function MailFilter({ box, view, scope }: { box: Box; view: MailView; scope?: string }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  function submit(q: string) {
    void navigate(
      destination({
        ...view,
        box: box.id,
        folder: undefined,
        message: undefined,
        q: q || undefined,
      }),
    );
  }
  return (
    <>
      <form
        className="mailsearch"
        role="search"
        key={view.q}
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("q");
          const q = typeof value === "string" ? value.trim() : "";
          submit(q);
        }}
      >
        <input
          ref={input}
          data-shortcut="/"
          type="search"
          aria-label="Search mailbox"
          name="q"
          maxLength={1024}
          placeholder={scope ? "Search " + scope : "Search mailbox"}
          defaultValue={view.q}
        />
        <button aria-label="Search" title="Search">
          <Search size={16} />
        </button>
      </form>
      <SearchFilters
        apply={(terms) => submit([input.current?.value.trim(), terms].filter(Boolean).join(" "))}
      />
      {view.q && <FilterChips view={view} box={box.id} q={view.q} />}
    </>
  );
}
