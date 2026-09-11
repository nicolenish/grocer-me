import { useEffect, useState } from "react";
import type { SavedRecipe } from "../types";
import { listSavedRecipes } from "../api";
import { addWeeks, hostOf, shortDate } from "../utils";

interface Props {
  focus: string;
  /** Recipe ids already on the focus week or the one after. */
  planned: Set<number>;
  onAdd: (dbId: number, week: string) => Promise<void>;
  onClose: () => void;
}

/** ⌘K: everything you've ever cooked, by name or ingredient. */
export default function SearchOverlay({ focus, planned, onAdd, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SavedRecipe[] | null>(null);
  const next = addWeeks(focus, 1);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listSavedRecipes(query.trim() || undefined)
        .then((found) => !cancelled && setResults(found))
        .catch(() => !cancelled && setResults([]));
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const add = async (dbId: number, week: string) => {
    await onAdd(dbId, week);
    onClose();
  };

  const q = query.trim();
  const note = results === null
    ? "searching…"
    : q
      ? `${results.length} match${results.length === 1 ? "" : "es"}`
      : `everything you've cooked · ${results.length}`;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="search" role="dialog" aria-label="Search everything you've cooked" onClick={(e) => e.stopPropagation()}>
        <div className="search-head">
          <span className="search-glyph" aria-hidden="true">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.length) add(results[0].id, focus);
            }}
            placeholder="search everything you've cooked — name or ingredient"
            aria-label="Search recipes"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="search-note">{note}</div>
        <div className="search-list">
          {results?.map((r) => (
            <div key={r.id} className="search-row">
              <div className="search-info">
                <div className="search-title">{r.title}</div>
                <div className="search-meta">
                  {hostOf(r.source_url)} · {r.ingredients.length} ingredients
                  {planned.has(r.id) ? " · already planned" : ""}
                </div>
              </div>
              <button className="search-btn" onClick={() => add(r.id, focus)}>→ {shortDate(focus)}</button>
              <button className="search-btn search-btn--accent" onClick={() => add(r.id, next)}>→ {shortDate(next)}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
