import axios from "axios";

const SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "for", "nor",
  "on", "at", "to", "by", "of", "in", "with", "from",
]);

// ───── Week helpers (weeks start on Monday) ─────

/** Local ISO date (YYYY-MM-DD) without timezone shift. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISODate(iso: string, plusDays = 0): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays);
}

/** Monday of the week containing `d` (defaults to today), as an ISO date string. */
export function mondayOf(d: Date = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (copy.getDay() + 6) % 7; // 0 = Monday
  copy.setDate(copy.getDate() - dow);
  return toISODate(copy);
}

/**
 * The week being planned: always the upcoming one. Recipes get pulled for next
 * week, never for the week already underway, whatever day it is today.
 */
export function planningWeek(d: Date = new Date()): string {
  return addWeeks(mondayOf(d), 1);
}

/** Shift an ISO Monday by a number of weeks. */
export function addWeeks(isoMonday: string, weeks: number): string {
  return toISODate(fromISODate(isoMonday, weeks * 7));
}

/** "Sep 7" for an ISO date, optionally shifted ("Sep 13" is the Sunday of that week). */
export function shortDate(iso: string, plusDays = 0): string {
  const dt = fromISODate(iso, plusDays);
  return `${dt.toLocaleString("en-US", { month: "short" })} ${dt.getDate()}`;
}

/** Whole weeks from this week to `isoMonday`; negative in the past. */
export function weeksFromNow(isoMonday: string): number {
  const diff = fromISODate(isoMonday).getTime() - fromISODate(mondayOf()).getTime();
  return Math.round(diff / (7 * 86400000));
}

/** Short tag for a week relative to now: "now", "next", "last", "in 3 wks", "5 wks ago". */
export function weekTag(isoMonday: string): string {
  const n = weeksFromNow(isoMonday);
  if (n === 0) return "now";
  if (n === 1) return "next";
  if (n === -1) return "last";
  return n > 1 ? `in ${n} wks` : `${-n} wks ago`;
}

/** A week before this one is history: dragging out of it copies instead of moving. */
export function isPastWeek(isoMonday: string): boolean {
  return isoMonday < mondayOf();
}

// ───── Formatting ─────

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "seriouseats.com/mapo-tofu" — enough of a URL to recognise it. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function boughtAgo(iso: string | null): string {
  if (!iso) return "never tracked";
  const days = Math.floor((Date.now() - fromISODate(iso).getTime()) / 86400000);
  if (days <= 0) return "bought today";
  if (days === 1) return "bought yesterday";
  if (days < 7) return `bought ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "bought 1 week ago" : `bought ${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "bought 1 month ago" : `bought ${months} months ago`;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The backend's own explanation when it gave one, otherwise something readable. */
export function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
    if (!err.response) return "Can't reach the backend on :8000 — is it running?";
  }
  return fallback;
}

export function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(" ")
    .map((word, i) => {
      if (word.length === 0) return word;
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
