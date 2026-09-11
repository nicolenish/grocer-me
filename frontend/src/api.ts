import axios from "axios";
import type {
  CartResponse,
  GroceryItem,
  GroceryList,
  PantryItem,
  ParseResult,
  Rotation,
  SavedRecipe,
  StoreStatus,
  WatchlistItem,
  Week,
} from "./types";

const api = axios.create({
  baseURL: "http://localhost:8000",
});

// Recipes

export async function parseRecipes(urls: string[], weekOf: string): Promise<ParseResult> {
  const response = await api.post<ParseResult>("/api/recipes/parse/", { urls, week_of: weekOf });
  return response.data;
}

export async function listSavedRecipes(q?: string): Promise<SavedRecipe[]> {
  const response = await api.get<SavedRecipe[]>("/api/recipes/saved/", {
    params: q ? { q } : undefined,
  });
  return response.data;
}

// Weeks

export async function listWeeks(start: string, count: number): Promise<Week[]> {
  const response = await api.get<Week[]>("/api/weeks/", { params: { start, count } });
  return response.data;
}

export async function addRecipeToWeek(dbId: number, weekOf: string): Promise<void> {
  await api.post("/api/plans/add-recipe/", { db_id: dbId, week_of: weekOf });
}

/** Moves between upcoming weeks; copies out of a week that's already over. */
export async function moveRecipe(dbId: number, fromWeek: string, toWeek: string): Promise<void> {
  await api.post("/api/plans/move-recipe/", { db_id: dbId, from_week: fromWeek, to_week: toWeek });
}

export async function setMultiplier(dbId: number, weekOf: string, multiplier: number): Promise<void> {
  await api.post("/api/plans/set-multiplier/", { db_id: dbId, week_of: weekOf, multiplier });
}

export async function removeRecipeFromPlan(dbId: number, weekOf: string): Promise<void> {
  await api.post("/api/plans/remove-recipe/", { db_id: dbId, week_of: weekOf });
}

// The week's list

export async function getGroceryList(weekOf: string): Promise<GroceryList> {
  const response = await api.get<GroceryList>("/api/grocery-list/current/", {
    params: { week_of: weekOf },
  });
  return response.data;
}

/** Re-merge the week's list from its plan. This is the call that costs a model request. */
export async function mergeWeek(weekOf: string): Promise<GroceryList> {
  const response = await api.post<GroceryList>("/api/grocery-list/merge/", { week_of: weekOf });
  return response.data;
}

export async function checkGroceryItem(weekOf: string, name: string, checked: boolean): Promise<void> {
  await api.post("/api/grocery-list/check/", { week_of: weekOf, name, checked });
}

// Already home

export async function listPantry(): Promise<PantryItem[]> {
  const response = await api.get<PantryItem[]>("/api/pantry/");
  return response.data;
}

export async function addPantryItem(name: string, category?: string): Promise<PantryItem> {
  const response = await api.post<PantryItem>("/api/pantry/add/", { name, category });
  return response.data;
}

export async function updatePantryItem(id: number, data: Partial<PantryItem>): Promise<PantryItem> {
  const response = await api.patch<PantryItem>(`/api/pantry/${id}/`, data);
  return response.data;
}

// On the shelf

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

// Store

export async function getStoreStatus(): Promise<StoreStatus> {
  const response = await api.get<StoreStatus>("/api/weee/login-status/");
  return response.data;
}

export async function storeLogin(): Promise<StoreStatus> {
  const response = await api.post<StoreStatus>("/api/weee/login/");
  return response.data;
}

export async function fillCart(items: GroceryItem[], weekOf: string): Promise<CartResponse> {
  const response = await api.post<CartResponse>("/api/weee/add-to-cart/", { items, week_of: weekOf });
  return response.data;
}

// Rotation

export async function getRotation(weeks = 26): Promise<Rotation> {
  const response = await api.get<Rotation>("/api/analytics/rotation/", { params: { weeks } });
  return response.data;
}
