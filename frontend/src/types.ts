export interface Ingredient {
  original_text: string;
  quantity: string | null;
  unit: string | null;
  name: string;
}

/** A freshly scraped recipe, as the parse endpoint returns it. */
export interface Recipe {
  id: string;
  db_id?: number;
  title: string;
  source_url: string;
  ingredients: Ingredient[];
  instructions: string[];
  servings: string | null;
}

export interface SavedRecipe {
  id: number;
  title: string;
  source_url: string;
  ingredients: Ingredient[];
  instructions: string[];
  servings: string | null;
}

/** A saved recipe as it sits on one week's plan. */
export interface PlannedRecipe extends SavedRecipe {
  multiplier: number;
}

export interface CartRun {
  id: number;
  store: string;
  added: number;
  total: number;
  unmatched: { name: string; status: string; message: string }[];
  created_at: string;
}

export interface Week {
  week_of: string;
  recipes: PlannedRecipe[];
  grocery_item_count: number;
  cart_run: CartRun | null;
}

export interface GroceryItem {
  name: string;
  quantity: string;
  unit: string;
  category: string;
  recipe_indices: number[];
  checked?: boolean;
  in_pantry?: boolean;
  leftover_from_last_week?: boolean;
}

export interface GroceryList {
  items: GroceryItem[];
  recipe_names: string[];
  /** The plan has changed since this list was merged. */
  stale: boolean;
}

export interface ParseError {
  url: string;
  error: string;
}

export interface ParseResult {
  recipes: Recipe[];
  errors: ParseError[];
}

export interface PantryItem {
  id: number;
  name: string;
  category: string;
  last_bought: string | null;
  auto_skip: boolean;
}

export interface WatchlistItem {
  id: number;
  url: string;
  note: string;
  created_at: string;
}

export interface StoreStatus {
  logged_in: boolean;
  message: string;
  store?: string;
  cart_url?: string | null;
}

export interface CartResult {
  name: string;
  status: "added" | "not_found" | "no_add_button" | "error";
  matched_product: string | null;
  message: string;
}

export interface CartResponse {
  message: string;
  results: CartResult[];
  run?: CartRun;
}

export interface Rotation {
  range: { start: string; end: string; weeks: number; first_week: string | null };
  dinners: number;
  distinct: number;
  avg_repeats: number;
  once_a_month: number;
  overcooked: number;
  times_cooked: { id: number; title: string; count: number; weeks_ago: number; over: boolean }[];
  times_cooked_hidden: number;
  concentration: {
    top: { id: number; title: string; count: number; share: number }[];
    top_share: number;
  };
  too_often: { id: number; title: string; count: number; note: string }[];
  protein_mix: { label: string; count: number; share: number }[];
  gone_cold: { id: number; title: string; weeks_ago: number; times: number }[];
}
