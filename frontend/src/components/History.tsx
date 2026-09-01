import { useState, useEffect, useRef } from "react";
import type { WeeklyPlan, SavedRecipe, Recipe } from "../types";
import { listWeeklyPlans, listSavedRecipes, loadSavedRecipes } from "../api";
import CookMode from "./CookMode";

const RECIPE_COLORS = [
  "#e07a5f", "#457b9d", "#6a994e", "#bc6c25",
  "#9b5de5", "#f15bb5", "#00bbf9", "#ff6b6b",
  "#4ecdc4", "#ffe66d",
];

interface Props {
  onLoadRecipes: (recipes: Recipe[]) => void;
}

function formatWeekLabel(weekOf: string): string {
  const d = new Date(weekOf + "T00:00:00");
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${d.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  return `${weeks} weeks ago`;
}

export default function History({ onLoadRecipes }: Props) {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [allRecipes, setAllRecipes] = useState<SavedRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"weeks" | "recipes">("weeks");
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<number>>(new Set());
  const [loadingId, setLoadingId] = useState<number | string | null>(null);
  const [cookingRecipe, setCookingRecipe] = useState<SavedRecipe | null>(null);
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [plansData, recipesData] = await Promise.all([
        listWeeklyPlans(),
        listSavedRecipes(),
      ]);
      setPlans(plansData);
      setAllRecipes(recipesData);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    try {
      const recipesData = await listSavedRecipes(q || undefined);
      setAllRecipes(recipesData);
    } catch { /* */ }
  };

  const toggleRecipe = (id: number) => {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLoadSelected = async () => {
    if (selectedRecipeIds.size === 0) return;
    setLoadingId("bulk");
    try {
      const loaded = await loadSavedRecipes(Array.from(selectedRecipeIds));
      onLoadRecipes(loaded);
      setSelectedRecipeIds(new Set());
    } catch { /* */ }
    finally { setLoadingId(null); }
  };

  const handleLoadSingle = async (recipeId: number) => {
    setLoadingId(recipeId);
    try {
      const loaded = await loadSavedRecipes([recipeId]);
      onLoadRecipes(loaded);
    } catch { /* */ }
    finally { setLoadingId(null); }
  };

  const handleLoadWeek = async (plan: WeeklyPlan) => {
    setLoadingId(`week-${plan.id}`);
    try {
      const dbIds = plan.recipes.map((r) => r.id);
      const loaded = await loadSavedRecipes(dbIds);
      onLoadRecipes(loaded);
    } catch { /* */ }
    finally { setLoadingId(null); }
  };

  if (loading) {
    return (
      <div className="step-content">
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <p className="subtitle">Loading your recipe history...</p>
        </div>
      </div>
    );
  }

  const hasHistory = plans.length > 0 || allRecipes.length > 0;

  return (
    <div className="step-content">
      <div className="section-header">
        <h2>Recipe History</h2>
        <p className="subtitle">
          {hasHistory
            ? "All your past recipes in one place. Pick any to cook again."
            : "Your recipe history will show up here after your first meal prep week."}
        </p>
      </div>

      {!hasHistory ? (
        <div className="empty-state" style={{ padding: "20px 0" }}>
          <div className="empty-icon">🍳</div>
          <p className="subtitle">No recipes saved yet. Start by adding some recipes!</p>
        </div>
      ) : (
        <>
          <div className="history-tabs">
            <button
              className={`history-tab ${view === "weeks" ? "active" : ""}`}
              onClick={() => setView("weeks")}
            >
              By Week
              {plans.length > 0 && <span className="tab-count">{plans.length}</span>}
            </button>
            <button
              className={`history-tab ${view === "recipes" ? "active" : ""}`}
              onClick={() => setView("recipes")}
            >
              All Recipes
              {allRecipes.length > 0 && <span className="tab-count">{allRecipes.length}</span>}
            </button>
          </div>

          {view === "weeks" ? (
            <div className="weeks-list">
              {plans.map((plan) => (
                <div key={plan.id} className="week-card">
                  <div className="week-card-header">
                    <div>
                      <h3 className="week-label">{formatWeekLabel(plan.week_of)}</h3>
                      <span className="week-meta">{timeAgo(plan.created_at)}</span>
                    </div>
                    <button
                      onClick={() => handleLoadWeek(plan)}
                      disabled={loadingId !== null}
                      className="btn-ghost btn-sm"
                    >
                      {loadingId === `week-${plan.id}` ? "Loading..." : "Cook All"}
                    </button>
                  </div>
                  <div className="week-recipe-list">
                    {plan.recipes.map((recipe, i) => (
                      <div key={recipe.id} className="week-recipe-item">
                        <span
                          className="week-recipe-dot"
                          style={{ backgroundColor: RECIPE_COLORS[i % RECIPE_COLORS.length] }}
                        />
                        <div className="week-recipe-info">
                          <span className="week-recipe-title">{recipe.title}</span>
                          <span className="week-recipe-source">
                            {new URL(recipe.source_url).hostname}
                          </span>
                        </div>
                        <button
                          onClick={() => setCookingRecipe(recipe)}
                          className="btn-cook"
                        >
                          👨‍🍳 Cook
                        </button>
                        <button
                          onClick={() => handleLoadSingle(recipe.id)}
                          disabled={loadingId !== null}
                          className="btn-secondary btn-sm"
                        >
                          {loadingId === recipe.id ? "Adding..." : "Add Again"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="all-recipes-view">
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="Search recipes..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="search-input"
                />
              </div>

              {selectedRecipeIds.size > 0 && (
                <div className="selection-bar">
                  <span>{selectedRecipeIds.size} selected</span>
                  <button
                    onClick={handleLoadSelected}
                    disabled={loadingId !== null}
                    className="btn-primary btn-sm"
                  >
                    {loadingId === "bulk" ? "Loading..." : "Add to This Week"}
                  </button>
                  <button
                    onClick={() => setSelectedRecipeIds(new Set())}
                    className="btn-ghost btn-sm"
                  >
                    Clear
                  </button>
                </div>
              )}

              <div className="saved-recipes-grid">
                {allRecipes.map((recipe) => {
                  const isSelected = selectedRecipeIds.has(recipe.id);
                  return (
                    <div
                      key={recipe.id}
                      className={`saved-recipe-card ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleRecipe(recipe.id)}
                    >
                      <div className={`select-circle ${isSelected ? "selected" : ""}`}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div className="saved-recipe-info">
                        <h4>{recipe.title}</h4>
                        <span className="saved-recipe-meta">
                          {new URL(recipe.source_url).hostname} · {recipe.ingredients.length} ingredients
                        </span>
                      </div>
                      <button
                        className="btn-cook"
                        onClick={(e) => { e.stopPropagation(); setCookingRecipe(recipe); }}
                      >
                        👨‍🍳 Cook
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {cookingRecipe && (
        <CookMode recipe={cookingRecipe} onClose={() => setCookingRecipe(null)} />
      )}
    </div>
  );
}
