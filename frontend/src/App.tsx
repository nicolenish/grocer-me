import { useState, useEffect, useRef } from "react";
import type { Recipe, GroceryItem, WeeeLoginStatus, WeeeCartResult } from "./types";
import { getWeeeLoginStatus } from "./api";
import { planningWeek } from "./utils";
import RecipeInput from "./components/RecipeInput";
import GroceryList from "./components/GroceryList";
import WeeeCart from "./components/WeeeCart";
import History from "./components/History";
import Fridge from "./components/Fridge";
import WeekPicker from "./components/WeekPicker";
import "./index.css";

const STEPS = [
  { key: "recipes", label: "Recipes", icon: "📝" },
  { key: "grocery", label: "Grocery List", icon: "🛒" },
  { key: "weee", label: "Weee!", icon: "🚀" },
  { key: "fridge", label: "Fridge", icon: "🧊" },
  { key: "history", label: "History", icon: "📚" },
] as const;

type Step = (typeof STEPS)[number]["key"];

function App() {
  const [currentStep, setCurrentStep] = useState<Step>("recipes");
  const [weekOf, setWeekOf] = useState<string>(() => planningWeek());
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [groceryItems, setGroceryItems] = useState<GroceryItem[]>([]);
  const [recipeNames, setRecipeNames] = useState<string[]>([]);
  const [multipliers, setMultipliers] = useState<Record<string, number>>({});
  const [weeeLoginStatus, setWeeeLoginStatus] = useState<WeeeLoginStatus | null>(null);
  const [weeeResults, setWeeeResults] = useState<WeeeCartResult[]>([]);
  const [weeeMessage, setWeeeMessage] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const didCheckWeee = useRef(false);

  useEffect(() => {
    if (didCheckWeee.current) return;
    didCheckWeee.current = true;
    getWeeeLoginStatus()
      .then(setWeeeLoginStatus)
      .catch(() => setWeeeLoginStatus({ logged_in: false, message: "Could not check" }));
  }, []);

  const handleLoadFromHistory = (loaded: Recipe[]) => {
    setRecipes((prev) => [...prev, ...loaded]);
    setCurrentStep("recipes");
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo-icon">🥬</span> grocer me
        </h1>
        <p>paste recipes. get groceries. skip the thinking.</p>
      </header>

      <nav className="step-nav">
        {STEPS.map((step) => (
          <button
            key={step.key}
            className={`step-tab ${currentStep === step.key ? "active" : ""}`}
            onClick={() => setCurrentStep(step.key)}
          >
            <span className="step-icon">{step.icon}</span>
            <span className="step-label">{step.label}</span>
            {step.key === "recipes" && recipes.length > 0 && (
              <span className="badge">{recipes.length}</span>
            )}
            {step.key === "grocery" && groceryItems.length > 0 && (
              <span className="badge">{groceryItems.length}</span>
            )}
          </button>
        ))}
      </nav>

      {(currentStep === "recipes" || currentStep === "grocery") && (
        <WeekPicker weekOf={weekOf} setWeekOf={setWeekOf} />
      )}

      <main className="main-content">
        {currentStep === "recipes" && (
          <RecipeInput
            recipes={recipes}
            setRecipes={setRecipes}
            multipliers={multipliers}
            setMultipliers={setMultipliers}
            weekOf={weekOf}
            onNext={() => setCurrentStep("grocery")}
            onOpenHistory={() => setCurrentStep("history")}
          />
        )}
        {currentStep === "grocery" && (
          <GroceryList
            recipes={recipes}
            groceryItems={groceryItems}
            setGroceryItems={setGroceryItems}
            recipeNames={recipeNames}
            setRecipeNames={setRecipeNames}
            multipliers={multipliers}
            weekOf={weekOf}
            checked={checkedItems}
            setChecked={setCheckedItems}
            onNext={() => setCurrentStep("weee")}
          />
        )}
        {currentStep === "weee" && (
          <WeeeCart
            groceryItems={groceryItems}
            checked={checkedItems}
            loginStatus={weeeLoginStatus}
            setLoginStatus={setWeeeLoginStatus}
            results={weeeResults}
            setResults={setWeeeResults}
            message={weeeMessage}
            setMessage={setWeeeMessage}
          />
        )}
        {currentStep === "fridge" && <Fridge />}
        {currentStep === "history" && (
          <History onLoadRecipes={handleLoadFromHistory} weekOf={weekOf} />
        )}
      </main>
    </div>
  );
}

export default App;
