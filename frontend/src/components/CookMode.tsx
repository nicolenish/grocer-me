import { useState, useEffect } from "react";
import type { Recipe, SavedRecipe } from "../types";
import { titleCase } from "../utils";

type CookableRecipe = Recipe | SavedRecipe;

interface Props {
  recipe: CookableRecipe;
  onClose: () => void;
}

function getField<T>(recipe: CookableRecipe, key: keyof Recipe & keyof SavedRecipe): T {
  return (recipe as any)[key] as T;
}

export default function CookMode({ recipe, onClose }: Props) {
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());

  const ingredients = recipe.ingredients ?? [];
  const instructions = recipe.instructions ?? [];
  const sourceUrl = getField<string>(recipe, "source_url");
  const servings = getField<string | null>(recipe, "servings");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Keep the screen awake while cooking
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        wakeLock = await navigator.wakeLock?.request("screen") ?? null;
      } catch {
        // User denied, unsupported, or page not visible — silently ignore
      }
    };

    // Re-acquire when tab becomes visible again (the lock is auto-released on hide)
    const onVisibility = () => {
      if (!cancelled && document.visibilityState === "visible") request();
    };

    request();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLock?.release().catch(() => {});
    };
  }, []);

  const toggleStep = (i: number) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const toggleIngredient = (i: number) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  let hostname = "";
  try { hostname = new URL(sourceUrl).hostname; } catch {}

  const stepsComplete = instructions.length > 0 && checkedSteps.size === instructions.length;

  return (
    <div className="cook-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cook-modal">
        {/* Header */}
        <div className="cook-header">
          <div className="cook-title-block">
            <h2 className="cook-title">{recipe.title}</h2>
            <div className="cook-meta">
              {hostname && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="cook-source">
                  {hostname} ↗
                </a>
              )}
              {servings && <span className="cook-servings">serves {servings}</span>}
              {stepsComplete && <span className="cook-done-badge">🎉 Done!</span>}
            </div>
          </div>
          <button className="cook-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        {/* Body — two columns */}
        <div className="cook-body">
          {/* Left: Ingredients */}
          <div className="cook-ingredients-col">
            <h3 className="cook-section-title">Ingredients</h3>
            <ul className="cook-ingredient-list">
              {ingredients.map((ing, i) => {
                const done = checkedIngredients.has(i);
                return (
                  <li
                    key={i}
                    className={`cook-ingredient ${done ? "done" : ""}`}
                    onClick={() => toggleIngredient(i)}
                  >
                    <span className={`cook-ing-check ${done ? "checked" : ""}`}>
                      {done && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <span className="cook-ing-text">
                      {ing.quantity && <strong>{ing.quantity} </strong>}
                      {ing.unit && <em>{ing.unit} </em>}
                      {titleCase(ing.name)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Right: Instructions */}
          <div className="cook-steps-col">
            <h3 className="cook-section-title">
              Instructions
              {instructions.length > 0 && (
                <span className="cook-step-progress">
                  {checkedSteps.size}/{instructions.length}
                </span>
              )}
            </h3>
            {instructions.length === 0 ? (
              <p className="cook-no-steps">
                No instructions saved — visit the{" "}
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">original recipe</a>{" "}
                for the full method.
              </p>
            ) : (
              <ol className="cook-step-list">
                {instructions.map((step, i) => {
                  const done = checkedSteps.has(i);
                  return (
                    <li
                      key={i}
                      className={`cook-step ${done ? "done" : ""}`}
                      onClick={() => toggleStep(i)}
                    >
                      <span className={`cook-step-num ${done ? "checked" : ""}`}>
                        {done ? (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : i + 1}
                      </span>
                      <span className="cook-step-text">{step}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
