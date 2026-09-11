import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GroceryItem, GroceryList, WatchlistItem, Week } from "./types";
import * as api from "./api";
import { addWeeks, errorMessage, hostOf } from "./utils";

export type ListStatus = "loading" | "ready" | "merging" | "error";

const EMPTY_LIST: GroceryList = { items: [], recipe_names: [], stale: false };

// A few drags in a row shouldn't each cost a model call: wait for a pause.
const MERGE_AFTER_MS = 1200;

/**
 * The four weeks around `focus`, the focus week's list, and every action that
 * changes them. Each action writes to the backend and then re-reads, so the
 * board only ever shows what's saved.
 *
 * Only the focus week's list is rebuilt automatically. Another week a change
 * touches keeps its saved list, which reports itself stale once focused.
 */
export function useWeekBoard(focus: string) {
  const [weeks, setWeeks] = useState<Week[]>([]);
  // The list and its error remember which week they belong to, so moving
  // the focus shows "loading" until that week's own list arrives.
  const [listFor, setListFor] = useState<{ week: string; data: GroceryList } | null>(null);
  const [listErr, setListErr] = useState<{ week: string; message: string } | null>(null);
  const [merging, setMerging] = useState<ReadonlySet<string>>(new Set());
  const [scraping, setScraping] = useState<Record<string, number>>({});
  const [shelf, setShelf] = useState<WatchlistItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const focusRef = useRef(focus);
  useLayoutEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  // Per week: the pending merge timer, and a counter so a slow merge that
  // has since been superseded can't overwrite a newer one.
  const timers = useRef(new Map<string, number>());
  const seqs = useRef(new Map<string, number>());

  const bumpSeq = useCallback((week: string) => {
    const n = (seqs.current.get(week) ?? 0) + 1;
    seqs.current.set(week, n);
    return n;
  }, []);

  const markMerging = useCallback((week: string, on: boolean) => {
    setMerging((prev) => {
      if (prev.has(week) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(week);
      else next.delete(week);
      return next;
    });
  }, []);

  const reloadWeeks = useCallback(async () => {
    const week = focusRef.current;
    try {
      const data = await api.listWeeks(addWeeks(week, -1), 4);
      if (focusRef.current === week) setWeeks(data);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load the weeks."));
    }
  }, []);

  const reloadList = useCallback(async () => {
    const week = focusRef.current;
    try {
      const data = await api.getGroceryList(week);
      if (focusRef.current !== week) return;
      setListFor({ week, data });
      setListErr(null);
    } catch (err) {
      if (focusRef.current === week) {
        setListErr({ week, message: errorMessage(err, "Couldn't load the list.") });
      }
    }
  }, []);

  const merge = useCallback(async (week: string) => {
    window.clearTimeout(timers.current.get(week));
    const seq = bumpSeq(week);
    markMerging(week, true);
    try {
      const data = await api.mergeWeek(week);
      if (seqs.current.get(week) !== seq || focusRef.current !== week) return;
      setListFor({ week, data });
      setListErr(null);
    } catch (err) {
      if (seqs.current.get(week) !== seq || focusRef.current !== week) return;
      setListErr({ week, message: errorMessage(err, "Couldn't merge the list.") });
    } finally {
      if (seqs.current.get(week) === seq) markMerging(week, false);
    }
  }, [bumpSeq, markMerging]);

  const scheduleMerge = useCallback((week: string) => {
    window.clearTimeout(timers.current.get(week));
    bumpSeq(week); // anything already in flight for this week is now stale
    markMerging(week, true);
    timers.current.set(week, window.setTimeout(() => merge(week), MERGE_AFTER_MS));
  }, [bumpSeq, markMerging, merge]);

  useEffect(() => {
    reloadWeeks();
    reloadList();
  }, [focus, reloadWeeks, reloadList]);

  useEffect(() => {
    api.listWatchlist().then(setShelf).catch(() => {});
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  /** Re-read the board after a change; rebuild the list if the change touched it. */
  const changed = useCallback(async (touched: string[]) => {
    await reloadWeeks();
    if (touched.includes(focusRef.current)) scheduleMerge(focusRef.current);
  }, [reloadWeeks, scheduleMerge]);

  const run = useCallback(async (touched: string[], work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err, "That didn't save."));
      await reloadWeeks();
      return;
    }
    await changed(touched);
  }, [changed, reloadWeeks]);

  /** Scrape URLs onto a week. Resolves to how many recipes made it. */
  const pull = useCallback(async (urls: string[], week: string) => {
    setScraping((s) => ({ ...s, [week]: (s[week] ?? 0) + urls.length }));
    try {
      const { recipes, errors } = await api.parseRecipes(urls, week);
      if (errors.length) {
        setError(errors.map((e) => `${hostOf(e.url) || "that url"}: ${e.error}`).join("\n"));
      }
      if (recipes.length) await changed([week]);
      return recipes.length;
    } catch (err) {
      setError(errorMessage(err, "Couldn't scrape that."));
      return 0;
    } finally {
      setScraping((s) => ({ ...s, [week]: Math.max((s[week] ?? 0) - urls.length, 0) }));
    }
  }, [changed]);

  const saveForLater = useCallback(async (urls: string[]) => {
    try {
      const { added } = await api.addToWatchlist(urls);
      setShelf((s) => [...added, ...s]);
      return true;
    } catch (err) {
      setError(errorMessage(err, "Couldn't save those for later."));
      return false;
    }
  }, []);

  const pullFromShelf = useCallback(async (item: WatchlistItem, week: string) => {
    if (await pull([item.url], week)) {
      setShelf((s) => s.filter((w) => w.id !== item.id));
      await api.removeFromWatchlist(item.id).catch(() => {});
    }
  }, [pull]);

  const dropFromShelf = useCallback(async (id: number) => {
    setShelf((s) => s.filter((w) => w.id !== id));
    await api.removeFromWatchlist(id).catch(() => {});
  }, []);

  const toggleItem = useCallback(async (item: GroceryItem) => {
    const week = focusRef.current;
    const checked = !item.checked;
    setListFor((l) =>
      l && l.week === week
        ? { week, data: { ...l.data, items: l.data.items.map((i) => (i === item ? { ...i, checked } : i)) } }
        : l,
    );
    try {
      await api.checkGroceryItem(week, item.name, checked);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
      reloadList();
    }
  }, [reloadList]);

  const list = listFor?.week === focus ? listFor.data : EMPTY_LIST;
  const listError = listErr?.week === focus ? listErr.message : null;
  const listStatus: ListStatus = merging.has(focus)
    ? "merging"
    : listError
      ? "error"
      : listFor?.week === focus
        ? "ready"
        : "loading";

  return {
    weeks,
    list,
    listStatus,
    listError,
    shelf,
    scraping,
    error,
    clearError: () => setError(null),
    reloadWeeks,
    reloadList,
    merge: () => merge(focus),
    pull,
    saveForLater,
    pullFromShelf,
    dropFromShelf,
    toggleItem,
    add: (dbId: number, week: string) => run([week], () => api.addRecipeToWeek(dbId, week)),
    move: (dbId: number, from: string, to: string) =>
      run([from, to], () => api.moveRecipe(dbId, from, to)),
    remove: (dbId: number, week: string) => run([week], () => api.removeRecipeFromPlan(dbId, week)),
    setMultiplier: (dbId: number, week: string, multiplier: number) =>
      run([week], () => api.setMultiplier(dbId, week, multiplier)),
  };
}

export type WeekBoardState = ReturnType<typeof useWeekBoard>;
