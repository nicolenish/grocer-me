import axios from "axios";
import type { Recipe, GroceryList, GroceryItem, WeeeCartResponse, WeeeLoginStatus, WeeklyPlan, SavedRecipe, PantryItem, ParseResult, WatchlistItem } from "./types";

const api = axios.create({
  baseURL: "http://localhost:8000",
});

export async function parseRecipes(urls: string[], weekOf?: string): Promise<ParseResult> {
  const response = await api.post<ParseResult>("/api/recipes/parse/", { urls, week_of: weekOf });
  return response.data;
}

export async function mergeGroceryList(
  recipeIds: string[],
  multipliers?: Record<string, number>,
  weekOf?: string
): Promise<GroceryList> {
  const response = await api.post<GroceryList>("/api/grocery-list/merge/", {
    recipe_ids: recipeIds,
    multipliers: multipliers ?? {},
    week_of: weekOf,
  });
  return response.data;
}

export async function getCurrentGroceryList(weekOf?: string): Promise<GroceryList | null> {
  try {
    const response = await api.get<GroceryList>("/api/grocery-list/current/", {
      params: weekOf ? { week_of: weekOf } : undefined,
    });
    return response.data;
  } catch {
    return null;
  }
}

export async function updateGroceryList(items: GroceryItem[]): Promise<GroceryList> {
  const response = await api.post<GroceryList>("/api/grocery-list/update/", {
    items,
  });
  return response.data;
}

export async function getWeeeLoginStatus(): Promise<WeeeLoginStatus> {
  const response = await api.get<WeeeLoginStatus>("/api/weee/login-status/");
  return response.data;
}

export async function weeeLogin(): Promise<WeeeLoginStatus> {
  const response = await api.post<WeeeLoginStatus>("/api/weee/login/");
  return response.data;
}

export async function addToWeeeCart(items: GroceryItem[]): Promise<WeeeCartResponse> {
  const response = await api.post<WeeeCartResponse>("/api/weee/add-to-cart/", {
    items,
  });
  return response.data;
}

export async function listWeeklyPlans(): Promise<WeeklyPlan[]> {
  const response = await api.get<WeeklyPlan[]>("/api/plans/");
  return response.data;
}

export async function saveWeeklyPlan(recipeIds: string[], weekOf?: string): Promise<{ id: number; week_of: string; recipe_count: number }> {
  const response = await api.post("/api/plans/save/", {
    recipe_ids: recipeIds,
    week_of: weekOf,
  });
  return response.data;
}

export async function listSavedRecipes(q?: string): Promise<SavedRecipe[]> {
  const response = await api.get<SavedRecipe[]>("/api/recipes/saved/", {
    params: q ? { q } : undefined,
  });
  return response.data;
}

export async function loadSavedRecipes(dbIds: number[]): Promise<Recipe[]> {
  const response = await api.post<Recipe[]>("/api/recipes/load/", { db_ids: dbIds });
  return response.data;
}

// Pantry
export async function listPantry(): Promise<PantryItem[]> {
  const response = await api.get<PantryItem[]>("/api/pantry/");
  return response.data;
}

export async function addPantryItem(name: string, category?: string): Promise<PantryItem> {
  const response = await api.post<PantryItem>("/api/pantry/add/", { name, category });
  return response.data;
}

export async function addPantryItemsBulk(items: { name: string; category?: string }[]): Promise<PantryItem[]> {
  const response = await api.post<PantryItem[]>("/api/pantry/bulk-add/", { items });
  return response.data;
}

export async function updatePantryItem(id: number, data: Partial<PantryItem>): Promise<PantryItem> {
  const response = await api.patch<PantryItem>(`/api/pantry/${id}/`, data);
  return response.data;
}

export async function deletePantryItem(id: number): Promise<void> {
  await api.delete(`/api/pantry/${id}/delete/`);
}

// Watchlist
export async function listWatchlist(): Promise<WatchlistItem[]> {
  const response = await api.get<WatchlistItem[]>("/api/watchlist/");
  return response.data;
}

export async function addToWatchlist(urls: string[]): Promise<{ added: WatchlistItem[]; already_exists: WatchlistItem[] }> {
  const response = await api.post("/api/watchlist/add/", { urls });
  return response.data;
}

export async function removeFromWatchlist(id: number): Promise<void> {
  await api.delete(`/api/watchlist/${id}/delete/`);
}
