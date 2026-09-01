import { useState, useEffect } from "react";
import type { Recipe, GroceryItem } from "../types";
import { mergeGroceryList, getCurrentGroceryList } from "../api";
import { titleCase } from "../utils";

const RECIPE_COLORS = [
  "#e07a5f", "#457b9d", "#6a994e", "#bc6c25",
  "#9b5de5", "#f15bb5", "#00bbf9", "#ff6b6b",
  "#4ecdc4", "#ffe66d",
];

const CATEGORY_CONFIG: Record<string, { label: string; emoji: string }> = {
  protein: { label: "Proteins & Tofu", emoji: "🥩" },
  produce: { label: "Vegetables & Fresh Produce", emoji: "🥬" },
  dairy: { label: "Dairy & Eggs", emoji: "🥚" },
  pantry: { label: "Pantry & Sauces", emoji: "🫙" },
  frozen: { label: "Frozen", emoji: "🧊" },
  other: { label: "Other", emoji: "📦" },
};

const CATEGORY_ORDER = ["protein", "produce", "dairy", "pantry", "frozen", "other"];

interface Props {
  recipes: Recipe[];
  groceryItems: GroceryItem[];
  setGroceryItems: React.Dispatch<React.SetStateAction<GroceryItem[]>>;
  recipeNames: string[];
  setRecipeNames: React.Dispatch<React.SetStateAction<string[]>>;
  multipliers: Record<string, number>;
  weekOf: string;
  checked: Record<string, boolean>;
  setChecked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onNext: () => void;
}

export default function GroceryList({
  recipes,
  groceryItems,
  setGroceryItems,
  recipeNames,
  setRecipeNames,
  multipliers,
  weekOf,
  checked,
  setChecked,
  onNext,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the selected week's saved grocery list, and reload when the week changes.
  useEffect(() => {
    getCurrentGroceryList(weekOf).then((result) => {
      const items = result?.items ?? [];
      setGroceryItems(items);
      setRecipeNames(result?.recipe_names ?? []);
      const initialChecked: Record<string, boolean> = {};
      items.forEach((item, index) => {
        if (item.in_pantry) {
          initialChecked[`${item.category || "other"}-${index}`] = true;
        }
      });
      setChecked(initialChecked);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOf]);

  const handleGenerate = async () => {
    if (recipes.length === 0) {
      setError("No recipes yet — go back and add some first!");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Prefer db_id so merge survives a server restart
      const recipeIds = recipes.map((r) => r.db_id != null ? String(r.db_id) : r.id);
      const result = await mergeGroceryList(recipeIds, multipliers, weekOf);
      setGroceryItems(result.items);
      setRecipeNames(result.recipe_names);
      const initialChecked: Record<string, boolean> = {};
      result.items.forEach((item, index) => {
        if (item.in_pantry) {
          const cat = item.category || "other";
          initialChecked[`${cat}-${index}`] = true;
        }
      });
      setChecked(initialChecked);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate grocery list";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRemoveItem = (index: number) => {
    setGroceryItems((prev) => prev.filter((_, i) => i !== index));
  };

  const total = groceryItems.length;
  const done = Object.values(checked).filter(Boolean).length;

  const groupedItems = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    config: CATEGORY_CONFIG[cat],
    items: groceryItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.category === cat),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="step-content grocery-step">
      {groceryItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <h2>Build your grocery list</h2>
          <p className="subtitle">
            We'll merge ingredients from {recipes.length || "your"} recipes,
            combine duplicates, and organize everything by aisle.
          </p>
          <button
            onClick={handleGenerate}
            disabled={loading || recipes.length === 0}
            className="btn-primary btn-lg"
          >
            {loading ? (
              <>
                <span className="spinner" /> Merging ingredients...
              </>
            ) : (
              <>Generate Grocery List</>
            )}
          </button>
          {loading && (
            <p className="loading-hint">
              AI is combining & deduplicating ingredients across all your recipes...
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="grocery-header">
            <div>
              <h2>Grocery List</h2>
              <p className="progress-text">
                {done} of {total} items checked — {recipeNames.length} recipes
              </p>
            </div>
            <div className="grocery-actions">
              <button onClick={handleGenerate} disabled={loading} className="btn-ghost">
                {loading ? "Regenerating..." : "↻ Regenerate"}
              </button>
              <button onClick={onNext} className="btn-secondary">
                Add to Weee! →
              </button>
            </div>
          </div>

          <div className="recipe-tags-bar">
            {recipeNames.map((name, i) => (
              <span
                key={i}
                className="recipe-tag"
                style={{
                  backgroundColor: RECIPE_COLORS[i % RECIPE_COLORS.length] + "18",
                  color: RECIPE_COLORS[i % RECIPE_COLORS.length],
                  borderColor: RECIPE_COLORS[i % RECIPE_COLORS.length] + "40",
                }}
              >
                {name.length > 28 ? name.substring(0, 28) + "…" : name}
              </span>
            ))}
          </div>

          <div className="grocery-groups">
            {groupedItems.map((group) => (
              <div key={group.category} className="grocery-group">
                <h3 className="category-label">
                  <span className="category-emoji">{group.config.emoji}</span>
                  {group.config.label}
                  <span className="category-count">{group.items.length}</span>
                </h3>
                <div className="grocery-items">
                  {group.items.map(({ item, index }) => {
                    const key = `${group.category}-${index}`;
                    const isDone = !!checked[key];
                    const isPantry = !!item.in_pantry;
                    return (
                      <div
                        key={index}
                        className={`grocery-item ${isDone ? "checked" : ""} ${isPantry && isDone ? "in-pantry" : ""}`}
                        onClick={() => toggle(key)}
                      >
                        <div className={`checkbox ${isDone ? "checked" : ""}`}>
                          {isDone && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path
                                d="M2.5 6L5 8.5L9.5 3.5"
                                stroke="white"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                        <div className="item-content">
                          <span className={`item-name ${isDone ? "done" : ""}`}>
                            {titleCase(item.name)}
                          </span>
                          <span className={`item-qty ${isDone ? "done" : ""}`}>
                            {item.quantity} {item.unit}
                          </span>
                          {isPantry && (
                            <span className="pantry-badge">have at home</span>
                          )}
                          {item.leftover_from_last_week && !isPantry && (
                            <span className="leftover-badge">bought last week</span>
                          )}
                          {item.recipe_indices && item.recipe_indices.length > 0 && (
                            <div className="item-recipe-tags">
                              {item.recipe_indices.map((ri) => (
                                <span
                                  key={ri}
                                  className="recipe-dot"
                                  style={{
                                    backgroundColor:
                                      RECIPE_COLORS[ri % RECIPE_COLORS.length] + "20",
                                    color: isDone
                                      ? "#bbb"
                                      : RECIPE_COLORS[ri % RECIPE_COLORS.length],
                                  }}
                                >
                                  {(recipeNames[ri] || "")
                                    .replace(/ \(.*\)/, "")
                                    .substring(0, 22)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveItem(index);
                          }}
                          className="btn-x"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
