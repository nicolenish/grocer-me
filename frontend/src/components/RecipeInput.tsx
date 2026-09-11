import { useState, useEffect, useRef } from "react";
import type { Recipe, ParseError, WatchlistItem, SavedRecipe } from "../types";
import { parseRecipes, listWatchlist, addToWatchlist, removeFromWatchlist, removeRecipeFromPlan, listSavedRecipes, loadSavedRecipes } from "../api";
import CookMode from "./CookMode";

const RECIPE_COLORS = [
  "#e07a5f", "#457b9d", "#6a994e", "#bc6c25",
  "#9b5de5", "#f15bb5", "#00bbf9", "#ff6b6b",
  "#4ecdc4", "#ffe66d",
];

interface Props {
  recipes: Recipe[];
  setRecipes: React.Dispatch<React.SetStateAction<Recipe[]>>;
  multipliers: Record<string, number>;
  setMultipliers: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  weekOf: string;
  onNext: () => void;
  onOpenHistory: () => void;
}

export default function RecipeInput({
  recipes,
  setRecipes,
  multipliers,
  setMultipliers,
  weekOf,
  onNext,
  onOpenHistory,
}: Props) {
  const [urlText, setUrlText] = useState("");
  const [loading, setLoading] = useState(false);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [cookingRecipe, setCookingRecipe] = useState<Recipe | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [savingWatchlist, setSavingWatchlist] = useState(false);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [pastQuery, setPastQuery] = useState("");
  const [pastResults, setPastResults] = useState<SavedRecipe[]>([]);
  const [searchingPast, setSearchingPast] = useState(false);
  const [addingPastId, setAddingPastId] = useState<number | null>(null);
  const didLoadWatchlist = useRef(false);

  useEffect(() => {
    if (didLoadWatchlist.current) return;
    didLoadWatchlist.current = true;
    listWatchlist().then(setWatchlist).catch(() => {});
  }, []);

  // Search saved recipes as the user types, debounced so each keystroke
  // doesn't fire its own request.
  useEffect(() => {
    const q = pastQuery.trim();
    if (!q) {
      setPastResults([]);
      setSearchingPast(false);
      return;
    }
    setSearchingPast(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      listSavedRecipes(q)
        .then((found) => { if (!cancelled) setPastResults(found); })
        .catch(() => { if (!cancelled) setPastResults([]); })
        .finally(() => { if (!cancelled) setSearchingPast(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pastQuery]);

  const getMultiplier = (id: string) => multipliers[id] ?? 1;
  const setMultiplier = (id: string, val: number) => {
    setMultipliers((prev) => ({ ...prev, [id]: Math.max(0.5, Math.round(val * 2) / 2) }));
  };

  const urlsFromText = () =>
    urlText.split("\n").map((u) => u.trim()).filter((u) => u.length > 0);

  const handleParse = async () => {
    const urls = urlsFromText();
    if (urls.length === 0) {
      setParseErrors([{ url: "", error: "Please enter at least one URL." }]);
      return;
    }
    setLoading(true);
    setParseErrors([]);
    try {
      const { recipes: parsed, errors } = await parseRecipes(urls, weekOf);
      setRecipes((prev) => {
        const existingUrls = new Set(prev.map((r) => r.source_url));
        return [...prev, ...parsed.filter((r) => !existingUrls.has(r.source_url))];
      });
      // Remove successfully parsed URLs from watchlist if they were there
      const parsedUrls = new Set(parsed.map((r) => r.source_url));
      setWatchlist((prev) => prev.filter((w) => !parsedUrls.has(w.url)));
      setParseErrors(errors);
      if (parsed.length > 0) setUrlText("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to parse recipes";
      setParseErrors([{ url: "", error: message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveForLater = async () => {
    const urls = urlsFromText();
    if (urls.length === 0) {
      setParseErrors([{ url: "", error: "Please enter at least one URL." }]);
      return;
    }
    setSavingWatchlist(true);
    setParseErrors([]);
    try {
      const { added } = await addToWatchlist(urls);
      setWatchlist((prev) => [...added, ...prev]);
      setUrlText("");
    } catch {
      setParseErrors([{ url: "", error: "Failed to save URLs." }]);
    } finally {
      setSavingWatchlist(false);
    }
  };

  const handlePromote = async (item: WatchlistItem) => {
    setPromotingId(item.id);
    try {
      const { recipes: parsed, errors } = await parseRecipes([item.url], weekOf);
      if (parsed.length > 0) {
        setRecipes((prev) => {
          const existingUrls = new Set(prev.map((r) => r.source_url));
          return [...prev, ...parsed.filter((r) => !existingUrls.has(r.source_url))];
        });
        setWatchlist((prev) => prev.filter((w) => w.id !== item.id));
        await removeFromWatchlist(item.id);
      }
      if (errors.length > 0) setParseErrors(errors);
    } catch {
      setParseErrors([{ url: item.url, error: "Failed to scrape recipe." }]);
    } finally {
      setPromotingId(null);
    }
  };

  const handleRemoveWatchlist = async (id: number) => {
    await removeFromWatchlist(id).catch(() => {});
    setWatchlist((prev) => prev.filter((w) => w.id !== id));
  };

  const handleAddPast = async (saved: SavedRecipe) => {
    setAddingPastId(saved.id);
    try {
      const loaded = await loadSavedRecipes([saved.id], weekOf);
      setRecipes((prev) => {
        const existingUrls = new Set(prev.map((r) => r.source_url));
        return [...prev, ...loaded.filter((r) => !existingUrls.has(r.source_url))];
      });
    } catch {
      setParseErrors([{ url: saved.source_url, error: "Could not add that recipe." }]);
    } finally {
      setAddingPastId(null);
    }
  };

  const handleRemove = async (recipe: Recipe) => {
    setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
    setMultipliers((prev) => { const next = { ...prev }; delete next[recipe.id]; return next; });
    // The recipe was attached to this week the moment it was scraped or loaded,
    // so it has to come off the saved plan as well as the on-screen list.
    if (recipe.db_id !== undefined) {
      await removeRecipeFromPlan(recipe.db_id, weekOf).catch(() => {});
    }
  };

  return (
    <div className="step-content">
      <div className="section-header">
        <h2>What are we cooking this week?</h2>
        <p className="subtitle">
          Drop your recipe URLs below — or{" "}
          <button onClick={onOpenHistory} className="link-btn">pick from past recipes</button>
        </p>
      </div>

      <div className="url-input-area">
        <textarea
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder={"https://www.maangchi.com/recipe/bibimbap\nhttps://thewoksoflife.com/sesame-oil-chicken/\nhttps://..."}
          rows={4}
          disabled={loading || savingWatchlist}
        />
        <div className="input-actions">
          <button onClick={handleParse} disabled={loading || savingWatchlist} className="btn-primary btn-lg">
            {loading ? <><span className="spinner" /> Scraping...</> : <>Pull Ingredients</>}
          </button>
          <button onClick={handleSaveForLater} disabled={loading || savingWatchlist} className="btn-ghost">
            {savingWatchlist ? "Saving..." : "🔖 Save for Later"}
          </button>
          <button onClick={onOpenHistory} className="btn-ghost">
            📚 Past Recipes
          </button>
        </div>
      </div>

      {/* Search what you've cooked before, without leaving this tab */}
      <div className="past-search">
        <div className="past-search-label">
          <span>or add from recipes you've cooked before</span>
        </div>
        <div className="search-bar">
          <input
            type="text"
            placeholder="🔍 Search past recipes by name or ingredient..."
            value={pastQuery}
            onChange={(e) => setPastQuery(e.target.value)}
            className="search-input"
          />
          {pastQuery && (
            <button
              onClick={() => setPastQuery("")}
              className="search-clear"
              title="Clear search"
            >✕</button>
          )}
        </div>

        {pastQuery.trim() && (
          <div className="past-results">
            {searchingPast && pastResults.length === 0 && (
              <p className="past-results-empty"><span className="spinner" /> Searching…</p>
            )}
            {!searchingPast && pastResults.length === 0 && (
              <p className="past-results-empty">
                Nothing saved matches “{pastQuery.trim()}”.
              </p>
            )}
            {pastResults.map((saved) => {
              const onMenu = recipes.some((r) => r.source_url === saved.source_url);
              let host = "";
              try { host = new URL(saved.source_url).hostname; } catch {}
              return (
                <div key={saved.id} className="past-result">
                  <div className="past-result-info">
                    <span className="past-result-title">{saved.title}</span>
                    <span className="past-result-meta">
                      {host}
                      {saved.ingredients.length > 0 && ` · ${saved.ingredients.length} ingredients`}
                    </span>
                  </div>
                  {onMenu ? (
                    <span className="past-result-on-menu">✓ on the menu</span>
                  ) : (
                    <button
                      onClick={() => handleAddPast(saved)}
                      disabled={addingPastId !== null}
                      className="btn-secondary btn-sm"
                    >
                      {addingPastId === saved.id ? "Adding…" : "+ Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {parseErrors.length > 0 && (
        <div className="parse-errors">
          {parseErrors.map((e, i) => {
            let host = "";
            try { host = e.url ? new URL(e.url).hostname : ""; } catch {}
            return (
              <p key={i} className="error">
                {host ? <><strong>{host}</strong>: {e.error}</> : e.error}
              </p>
            );
          })}
        </div>
      )}

      {recipes.length > 0 && (
        <div className="recipe-list">
          <div className="recipe-list-header">
            <h3>This week's menu ({recipes.length})</h3>
            <button onClick={onNext} className="btn-secondary">
              Next: Build Grocery List →
            </button>
          </div>

          <div className="recipe-tags-bar">
            {recipes.map((recipe, i) => (
              <span
                key={recipe.id}
                className="recipe-tag"
                style={{
                  backgroundColor: RECIPE_COLORS[i % RECIPE_COLORS.length] + "18",
                  color: RECIPE_COLORS[i % RECIPE_COLORS.length],
                  borderColor: RECIPE_COLORS[i % RECIPE_COLORS.length] + "40",
                }}
              >
                {recipe.title.length > 30 ? recipe.title.substring(0, 30) + "…" : recipe.title}
              </span>
            ))}
          </div>

          {recipes.map((recipe, i) => {
            const mult = getMultiplier(recipe.id);
            return (
              <div key={recipe.id} className="recipe-card" style={{ borderLeftColor: RECIPE_COLORS[i % RECIPE_COLORS.length] }}>
                <div className="card-header">
                  <div>
                    <h4>{recipe.title}</h4>
                    <div className="card-meta">
                      <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" className="source-link">
                        {new URL(recipe.source_url).hostname} ↗
                      </a>
                      {recipe.servings && <span className="servings-badge">serves {recipe.servings}</span>}
                      <span className="ingredient-count">{recipe.ingredients.length} ingredients</span>
                    </div>
                  </div>
                  <div className="card-right">
                    <div className="multiplier-control" title="Serving multiplier">
                      <button className="mult-btn" onClick={() => setMultiplier(recipe.id, mult - 0.5)} disabled={mult <= 0.5}>−</button>
                      <span className="mult-value">{mult}×</span>
                      <button className="mult-btn" onClick={() => setMultiplier(recipe.id, mult + 0.5)}>+</button>
                    </div>
                    <button onClick={() => setCookingRecipe(recipe)} className="btn-cook" title="Cook this recipe">
                      👨‍🍳 Cook
                    </button>
                    <button onClick={() => handleRemove(recipe)} className="btn-remove" title="Remove recipe">✕</button>
                  </div>
                </div>
                <ul className="ingredient-list">
                  {recipe.ingredients.map((ing, idx) => (
                    <li key={idx}>
                      {ing.quantity && <span className="ing-qty">{ing.quantity}</span>}
                      {ing.unit && <span className="ing-unit">{ing.unit}</span>}{" "}
                      {ing.name}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Watchlist shelf */}
      {watchlist.length > 0 && (
        <div className="watchlist-section">
          <h3 className="watchlist-heading">
            <span>🔖 Saved for Later</span>
            <span className="watchlist-count">{watchlist.length}</span>
          </h3>
          <div className="watchlist-items">
            {watchlist.map((item) => {
              let host = "";
              try { host = new URL(item.url).hostname; } catch {}
              const isPromoting = promotingId === item.id;
              return (
                <div key={item.id} className="watchlist-item">
                  <div className="watchlist-item-info">
                    <span className="watchlist-host">{host || item.url}</span>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="watchlist-url">
                      {item.url.length > 60 ? item.url.substring(0, 60) + "…" : item.url}
                    </a>
                  </div>
                  <div className="watchlist-item-actions">
                    <button
                      onClick={() => handlePromote(item)}
                      disabled={isPromoting || loading}
                      className="btn-primary btn-sm"
                    >
                      {isPromoting ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Scraping…</> : "Add this week"}
                    </button>
                    <button
                      onClick={() => handleRemoveWatchlist(item.id)}
                      className="btn-remove"
                      title="Remove"
                    >✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cookingRecipe && (
        <CookMode recipe={cookingRecipe} onClose={() => setCookingRecipe(null)} />
      )}
    </div>
  );
}
