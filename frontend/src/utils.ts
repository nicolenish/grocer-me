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

/** Monday of the week containing `d` (defaults to today), as an ISO date string. */
export function mondayOf(d: Date = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (copy.getDay() + 6) % 7; // 0 = Monday
  copy.setDate(copy.getDate() - dow);
  return toISODate(copy);
}

/**
 * The week to default to when planning. Meal-planning happens on Thursday for
 * the *following* week, so from Thursday onward we default to next week; Mon–Wed
 * still default to the current (in-progress) week.
 */
export function planningWeek(d: Date = new Date()): string {
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const thisMonday = mondayOf(d);
  return dow >= 3 ? addWeeks(thisMonday, 1) : thisMonday; // Thu(3)–Sun(6) → next week
}

/** Shift an ISO Monday by a number of weeks. */
export function addWeeks(isoMonday: string, weeks: number): string {
  const [y, m, d] = isoMonday.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + weeks * 7);
  return toISODate(dt);
}

/** Human label for a Monday-week, e.g. "Jul 13 – 19" or "Jun 30 – Jul 6". */
export function formatWeekRange(isoMonday: string): string {
  const [y, m, d] = isoMonday.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const mon = (dt: Date) => dt.toLocaleString("en-US", { month: "short" });
  if (start.getMonth() === end.getMonth()) {
    return `${mon(start)} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${mon(start)} ${start.getDate()} – ${mon(end)} ${end.getDate()}`;
}

/** Relative descriptor for a Monday-week vs. the current week: "This week", "Next week", etc. */
export function weekRelativeLabel(isoMonday: string): string {
  const thisMonday = mondayOf();
  const diffDays = Math.round(
    (new Date(isoMonday).getTime() - new Date(thisMonday).getTime()) / 86400000
  );
  const weeks = Math.round(diffDays / 7);
  if (weeks === 0) return "This week";
  if (weeks === 1) return "Next week";
  if (weeks === -1) return "Last week";
  if (weeks > 1) return `In ${weeks} weeks`;
  return `${Math.abs(weeks)} weeks ago`;
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
