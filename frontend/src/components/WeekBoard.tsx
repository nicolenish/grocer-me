import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent, ReactNode, WheelEvent } from "react";
import type { PlannedRecipe, WatchlistItem, Week } from "../types";
import type { WeekBoardState } from "../useWeekBoard";
import { addWeeks, hostOf, isPastWeek, planningWeek, shortDate, shortUrl, weekTag } from "../utils";

const ROLES = ["prev", "focus", "next", "after"] as const;
type Role = (typeof ROLES)[number];

interface Drag {
  dbId: number;
  week: string;
}

const urlsIn = (text: string) => text.split(/\s+/).filter((s) => /^https?:\/\//i.test(s));

interface Props {
  focus: string;
  setFocus: (week: string) => void;
  board: WeekBoardState;
  /** Arrow keys step through weeks only while nothing is on top of the board. */
  keysActive: boolean;
  onCook: (recipe: PlannedRecipe) => void;
}

/** Four weeks side by side, the one being planned in the middle. */
export default function WeekBoard({ focus, setFocus, board, keysActive, onCook }: Props) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const wheel = useRef({ acc: 0, at: 0 });

  const upcoming = planningWeek();
  const pulling = (board.scraping[focus] ?? 0) > 0;
  const byWeek = new Map(board.weeks.map((w) => [w.week_of, w]));
  const dates = [-1, 0, 1, 2].map((n) => addWeeks(focus, n));
  const hint = drag ? (isPastWeek(drag.week) ? "release to copy here" : "release to move here") : null;

  const pull = async () => {
    const urls = urlsIn(text);
    if (!urls.length || pulling) return;
    if (await board.pull(urls, focus)) setText("");
  };

  const later = async () => {
    const urls = urlsIn(text);
    if (!urls.length) return;
    setSaving(true);
    if (await board.saveForLater(urls)) setText("");
    setSaving(false);
  };

  useEffect(() => {
    if (!keysActive) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") setFocus(addWeeks(focus, -1));
      if (e.key === "ArrowRight") setFocus(addWeeks(focus, 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysActive, focus, setFocus]);

  // A horizontal swipe steps one week; a short cooldown keeps one flick from
  // spinning through a month.
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const w = wheel.current;
    const now = Date.now();
    if (now - w.at < 450) {
      w.acc = 0;
      return;
    }
    w.acc += e.deltaX;
    if (Math.abs(w.acc) < 60) return;
    setFocus(addWeeks(focus, w.acc > 0 ? 1 : -1));
    w.acc = 0;
    w.at = now;
  };

  const dropOn = (week: string) => (e: DragEvent) => {
    e.preventDefault();
    const from = drag;
    setDrag(null);
    if (from) {
      if (from.week !== week) board.move(from.dbId, from.week, week);
      return;
    }
    // Not one of ours: maybe a link dragged in from another tab.
    const urls = urlsIn(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"));
    if (urls.length) board.pull(urls, week);
  };

  return (
    <section className="board">
      <div className="topbar">
        <form
          className="paste"
          onSubmit={(e) => {
            e.preventDefault();
            pull();
          }}
        >
          <span className="paste-label">paste</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`https://…  ⏎ to pull ingredients into week of ${shortDate(focus)}`}
            aria-label="Recipe URLs"
            spellCheck={false}
          />
          <button type="submit" className={pulling ? "btn btn--busy" : "btn btn--accent"} disabled={pulling}>
            {pulling ? "Scraping…" : "Pull"}
          </button>
          <button type="button" className="btn" onClick={later} disabled={saving} title="Put it on the shelf for another week">
            Later
          </button>
        </form>
        <div className="topbar-rule" />
        <div className="topbar-right">
          <span className="axis-hint">{drag ? "drop on any week" : "scroll ⇄ weeks"}</span>
          <button className="btn-today" onClick={() => setFocus(upcoming)} title="Back to the week you're planning">
            Next week
          </button>
        </div>
      </div>

      {board.error && (
        <div className="board-error" role="alert">
          <span>{board.error}</span>
          <button onClick={board.clearError} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="cols" onWheel={onWheel}>
        {dates.map((week, i) => (
          <WeekColumn
            key={week}
            role={ROLES[i]}
            week={week}
            data={byWeek.get(week)}
            drag={drag}
            hint={hint}
            scraping={board.scraping[week] ?? 0}
            onDrop={dropOn(week)}
            onDragStart={setDrag}
            onDragEnd={() => setDrag(null)}
            onCook={onCook}
            onRemove={(dbId) => board.remove(dbId, week)}
            onMultiplier={(dbId, m) => board.setMultiplier(dbId, week, m)}
          >
            {ROLES[i] === "next" && (
              <Shelf
                items={board.shelf}
                week={week}
                onPull={(item) => board.pullFromShelf(item, week)}
                onDrop={board.dropFromShelf}
              />
            )}
          </WeekColumn>
        ))}
      </div>
    </section>
  );
}

interface ColumnProps {
  role: Role;
  week: string;
  data?: Week;
  drag: Drag | null;
  hint: string | null;
  scraping: number;
  onDrop: (e: DragEvent) => void;
  onDragStart: (drag: Drag) => void;
  onDragEnd: () => void;
  onCook: (recipe: PlannedRecipe) => void;
  onRemove: (dbId: number) => void;
  onMultiplier: (dbId: number, multiplier: number) => void;
  children?: ReactNode;
}

function WeekColumn({
  role, week, data, drag, hint, scraping,
  onDrop, onDragStart, onDragEnd, onCook, onRemove, onMultiplier, children,
}: ColumnProps) {
  const [over, setOver] = useState(false);
  const past = isPastWeek(week);
  const recipes = data?.recipes ?? [];
  const variant = past ? "past" : role === "focus" ? "focus" : "compact";
  const dim = role === "prev" || role === "after";

  let note: string | null = null;
  if (past) {
    const run = data?.cart_run;
    if (run) note = `shopped · ${run.added} of ${run.total}`;
    else if (data?.grocery_item_count) note = `list · ${data.grocery_item_count} items`;
    else if (!recipes.length) note = "nothing planned";
  }

  return (
    <div
      className={`col col--${role}${dim ? " is-dim" : ""}${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = drag && !isPastWeek(drag.week) ? "move" : "copy";
      }}
      onDragEnter={() => setOver(true)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
    >
      <header>
        <div className="col-kicker">Week of · {weekTag(week)}</div>
        {role === "focus" ? (
          <div className="col-date-row">
            <span className="col-date">{shortDate(week)}</span>
            <span className="col-through">through {shortDate(week, 6)}</span>
          </div>
        ) : (
          <div className="col-date">{shortDate(week)}</div>
        )}
      </header>

      <div className="col-cards">
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            variant={variant}
            dragging={drag?.dbId === recipe.id && drag.week === week}
            onDragStart={() => onDragStart({ dbId: recipe.id, week })}
            onDragEnd={onDragEnd}
            onCook={() => onCook(recipe)}
            onRemove={past ? undefined : () => onRemove(recipe.id)}
            onMultiplier={variant === "focus" ? (m) => onMultiplier(recipe.id, m) : undefined}
          />
        ))}
        {scraping > 0 && (
          <div className="card-pending">scraping {scraping === 1 ? "a recipe" : `${scraping} recipes`}…</div>
        )}
        {past ? (
          <>
            {note && <div className="col-note">{note}</div>}
            {hint && <div className="drop-hint is-active">{hint}</div>}
          </>
        ) : (
          <div className={`drop-hint${hint ? " is-active" : ""}`}>
            {hint ?? (role === "focus" ? "drop a url here" : "drag a recipe over")}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

interface CardProps {
  recipe: PlannedRecipe;
  variant: "past" | "focus" | "compact";
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onCook: () => void;
  onRemove?: () => void;
  onMultiplier?: (multiplier: number) => void;
}

function RecipeCard({ recipe, variant, dragging, onDragStart, onDragEnd, onCook, onRemove, onMultiplier }: CardProps) {
  const foot = (
    <div className="card-foot">
      <span>{hostOf(recipe.source_url)}</span>
      <span>{recipe.ingredients.length} ing</span>
    </div>
  );

  return (
    <div
      className={`card card--${variant}${dragging ? " is-dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", recipe.title);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onCook}
      onKeyDown={(e) => e.key === "Enter" && onCook()}
      role="button"
      tabIndex={0}
      title="Open in cook mode, or drag to another week"
    >
      {variant === "past" && recipe.title}
      {variant === "compact" && (
        <>
          <div className="card-title">{recipe.title}</div>
          {foot}
        </>
      )}
      {variant === "focus" && (
        <>
          <div className="card-head">
            <div className="card-title">{recipe.title}</div>
            {onMultiplier && <Multiplier value={recipe.multiplier} onChange={onMultiplier} />}
          </div>
          {foot}
        </>
      )}
      {onRemove && (
        <button
          className="card-x"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Take it off this week"
          aria-label={`Take ${recipe.title} off this week`}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function Multiplier({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <span className="mult" onClick={stop}>
      <button onClick={() => onChange(value - 0.5)} disabled={value <= 0.5} aria-label="Fewer servings">−</button>
      <span className="mult-value">{value.toFixed(1)}×</span>
      <button onClick={() => onChange(value + 0.5)} aria-label="More servings">+</button>
    </span>
  );
}

interface ShelfProps {
  items: WatchlistItem[];
  week: string;
  onPull: (item: WatchlistItem) => void;
  onDrop: (id: number) => void;
}

/** Recipes saved with "Later", waiting for a week. */
function Shelf({ items, week, onPull, onDrop }: ShelfProps) {
  return (
    <div className="shelf">
      <div className="col-kicker">On the shelf · {items.length}</div>
      {items.length === 0 ? (
        <div className="shelf-empty">empty · “Later” puts a url here</div>
      ) : (
        <div className="shelf-list">
          {items.map((item) => (
            <div key={item.id} className="shelf-row">
              <a className="shelf-url" href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}>
                {shortUrl(item.url)}
              </a>
              <button className="shelf-x" onClick={() => onDrop(item.id)} aria-label="Take it off the shelf" title="Take it off the shelf">
                ✕
              </button>
              <button
                className="shelf-add"
                onClick={() => onPull(item)}
                title={`Pull into week of ${shortDate(week)}`}
                aria-label={`Pull into week of ${shortDate(week)}`}
              >
                ＋
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
