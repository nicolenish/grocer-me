export interface Ingredient {
  original_text: string;
  quantity: string | null;
  unit: string | null;
  name: string;
}

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

export interface WeeklyPlan {
  id: number;
  week_of: string;
  created_at: string;
  recipes: SavedRecipe[];
}

export interface GroceryItem {
  name: string;
  quantity: string;
  unit: string;
  category: string;
  recipe_indices: number[];
  in_pantry?: boolean;
  leftover_from_last_week?: boolean;
}

export interface ParseError {
  url: string;
  error: string;
}

export interface ParseResult {
  recipes: Recipe[];
  errors: ParseError[];
}

export interface GroceryList {
  items: GroceryItem[];
  recipe_names: string[];
}

export interface PantryItem {
  id: number;
  name: string;
  category: string;
  last_bought: string | null;
  auto_skip: boolean;
}

export interface WeeeCartResult {
  name: string;
  status: "added" | "not_found" | "no_add_button" | "error";
  matched_product: string | null;
  message: string;
}

export interface WeeeCartResponse {
  message: string;
  results: WeeeCartResult[];
}

export interface WatchlistItem {
  id: number;
  url: string;
  note: string;
  created_at: string;
}

export interface WeeeLoginStatus {
  logged_in: boolean;
  message: string;
}
