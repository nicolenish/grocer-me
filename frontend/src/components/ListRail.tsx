import { useEffect, useState } from "react";
import type { GroceryItem, PantryItem, Week } from "../types";
import type { WeekBoardState } from "../useWeekBoard";
import { addPantryItem, listPantry, updatePantryItem } from "../api";
import { boughtAgo, capitalize, errorMessage, pad2, shortDate } from "../utils";
import CartPanel from "./CartPanel";

const LIST_GROUPS: [string, string][] = [
  ["protein", "Protein"],
  ["produce", "Produce"],
  ["dairy", "Dairy"],
  ["pantry", "Pantry"],
  ["frozen", "Frozen"],
  ["other", "Other"],
];

const HOME_GROUPS: [string, string][] = [
  ["sauce", "Sauces"],
  ["oil", "Oils & vinegars"],
  ["spice", "Spices"],
  ["pantry", "Staples"],
  ["dairy", "Dairy"],
  ["other", "Other"],
];

/** Sort items into fixed groups; anything with an unknown category lands in "other". */
function grouped<T>(items: T[], groups: [string, string][], categoryOf: (item: T) => string) {
  const known = new Set(groups.map(([key]) => key));
  return groups
    .map(([key, label]) => ({
      key,
      label,
      items: items.filter((item) => (known.has(categoryOf(item)) ? categoryOf(item) : "other") === key),
    }))
    .filter((g) => g.items.length > 0);
}

interface Props {
  focus: string;
  week?: Week;
  board: WeekBoardState;
}

/** The focus week's list, what's already home, and the cart. */
export default function ListRail({ focus, week, board }: Props) {
  const [pane, setPane] = useState<"list" | "home">("list");
  const [pantry, setPantry] = useState<PantryItem[]>([]);

  useEffect(() => {
    listPantry().then(setPantry).catch(() => {});
  }, []);

  const { list, listStatus } = board;
  const buy = list.items.filter((i) => !i.in_pantry && !i.checked);
  const skipped = list.items.length - buy.length;
  const busy = listStatus === "merging" || listStatus === "loading";
  const share = list.items.length ? buy.length / list.items.length : 0;

  // Skipping or including a staple changes which list items count as home.
  const pantryChanged = (next: PantryItem[]) => {
    setPantry(next);
    board.reloadList();
  };

  const blocked = listStatus === "merging"
    ? "waiting on the merge"
    : list.stale
      ? "rebuild the list first"
      : null;

  return (
    <aside className="rail">
      <div className="rail-head">
        <span className="rail-kicker">List · week of {shortDate(focus)}</span>
        <div className="rail-count-row">
          <span className="rail-count">{busy ? "—" : buy.length}</span>
          <span className="rail-count-label">to buy</span>
          <span className="rail-note">
            {listStatus === "merging" ? "merging duplicates…" : listStatus === "loading" ? "loading…" : `${skipped} skipped`}
          </span>
        </div>
        <div className="meter" aria-hidden="true">
          <div className="meter-fill" style={{ flex: Math.max(share * 100, 1) }} />
          <div className="meter-rest" style={{ flex: Math.max(100 - share * 100, 1) }} />
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={pane === "list"} className={`tab${pane === "list" ? " on" : ""}`} onClick={() => setPane("list")}>
          List <span className="tab-n">{list.items.length}</span>
        </button>
        <button role="tab" aria-selected={pane === "home"} className={`tab${pane === "home" ? " on" : ""}`} onClick={() => setPane("home")}>
          Already home <span className="tab-n">{pantry.filter((p) => p.auto_skip).length}</span>
        </button>
      </div>

      <div className="rail-body">
        {pane === "list" ? (
          <ListPane board={board} planned={week?.recipes.length ?? 0} />
        ) : (
          <HomePane pantry={pantry} onChange={pantryChanged} />
        )}
      </div>

      <CartPanel
        focus={focus}
        buy={buy}
        blocked={blocked}
        lastRun={week?.cart_run ?? null}
        onRun={board.reloadWeeks}
      />
    </aside>
  );
}

function ListPane({ board, planned }: { board: WeekBoardState; planned: number }) {
  const { list, listStatus, listError } = board;

  if (listStatus === "loading") return <p className="rail-empty">loading the list…</p>;

  const banner = listError ? (
    <div className="rail-banner is-error">
      <span>{listError}</span>
      <button onClick={board.merge}>try again</button>
    </div>
  ) : list.stale && listStatus !== "merging" ? (
    <div className="rail-banner">
      <span>the plan changed since this list was merged</span>
      <button onClick={board.merge}>rebuild</button>
    </div>
  ) : null;

  if (!list.items.length) {
    return (
      <>
        {banner}
        {listStatus === "merging" ? (
          <p className="rail-empty">
            merging {planned} recipe{planned === 1 ? "" : "s"}: combining duplicates, summing quantities, sorting by aisle…
          </p>
        ) : planned ? (
          <div className="rail-empty">
            <p>No list for this week yet.</p>
            <button className="btn btn--accent" onClick={board.merge}>
              Merge {planned} recipe{planned === 1 ? "" : "s"}
            </button>
          </div>
        ) : (
          <p className="rail-empty">
            Nothing planned this week. Paste a url or drag a recipe over and the list builds itself.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {banner}
      {grouped(list.items, LIST_GROUPS, (i) => i.category).map((group) => (
        <div key={group.key}>
          <div className="group-head">
            <span>{group.label}</span>
            <span>{pad2(group.items.length)}</span>
          </div>
          {group.items.map((item, i) => (
            <ListItem
              key={`${item.name}-${i}`}
              item={item}
              recipeNames={list.recipe_names}
              onToggle={() => board.toggleItem(item)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function ListItem({ item, recipeNames, onToggle }: { item: GroceryItem; recipeNames: string[]; onToggle: () => void }) {
  const have = !!(item.in_pantry || item.checked);
  const usedBy = item.recipe_indices ?? [];
  const qty = `${item.quantity ?? ""} ${item.unit ?? ""}`.trim();
  const forRecipes = usedBy.map((i) => recipeNames[i]).filter(Boolean).join(", ");

  const title = item.in_pantry
    ? "Already home. Change that in the Already home tab."
    : have
      ? "Put it back on the list"
      : `Have it already? Click to skip it.${forRecipes ? `\nFor: ${forRecipes}` : ""}`;

  return (
    <button
      className={`item${have ? " is-have" : ""}${item.in_pantry ? " is-pantry" : ""}`}
      onClick={item.in_pantry ? undefined : onToggle}
      aria-pressed={have}
      title={title}
    >
      <span className="item-name">
        {capitalize(item.name)}
        {usedBy.length > 1 && <span className="item-shared">  ·{usedBy.length}</span>}
      </span>
      <span className="item-qty">{have ? "have it" : qty || "—"}</span>
    </button>
  );
}

function HomePane({ pantry, onChange }: { pantry: PantryItem[]; onChange: (next: PantryItem[]) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const item = await addPantryItem(trimmed);
      onChange([...pantry.filter((p) => p.id !== item.id), item]);
      setName("");
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't add that."));
    }
  };

  const toggle = async (item: PantryItem) => {
    try {
      const updated = await updatePantryItem(item.id, { auto_skip: !item.auto_skip });
      onChange(pantry.map((p) => (p.id === item.id ? updated : p)));
    } catch (err) {
      setError(errorMessage(err, "Couldn't change that."));
    }
  };

  const sorted = [...pantry].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="home-add">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add an item…"
          aria-label="Add something you already have"
        />
      </div>
      {error && <div className="rail-banner is-error"><span>{error}</span></div>}
      {pantry.length === 0 && (
        <p className="rail-empty">
          Nothing tracked yet. Add the sauces and staples you keep around and they'll be skipped on every list.
        </p>
      )}
      {grouped(sorted, HOME_GROUPS, (p) => p.category).map((group) => (
        <div key={group.key}>
          <div className="group-head">
            <span>{group.label}</span>
            <span>{pad2(group.items.length)}</span>
          </div>
          {group.items.map((item) => (
            <div key={item.id} className="home-row">
              <span className="home-name">
                {capitalize(item.name)}
                <span className="home-when">{boughtAgo(item.last_bought)}</span>
              </span>
              <button
                className={`pill${item.auto_skip ? " on" : ""}`}
                onClick={() => toggle(item)}
                title={item.auto_skip ? "Skipped on every list. Click to buy it again." : "Goes on the list. Click to skip it."}
              >
                {item.auto_skip ? "skip" : "include"}
              </button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
