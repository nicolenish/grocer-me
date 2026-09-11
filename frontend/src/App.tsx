import { useEffect, useState } from "react";
import type { PlannedRecipe } from "./types";
import { useWeekBoard } from "./useWeekBoard";
import { addWeeks, planningWeek } from "./utils";
import Spine, { type View } from "./components/Spine";
import WeekBoard from "./components/WeekBoard";
import ListRail from "./components/ListRail";
import Rotation from "./components/Rotation";
import SearchOverlay from "./components/SearchOverlay";
import CookMode from "./components/CookMode";

function App() {
  const [view, setView] = useState<View>("week");
  const [focus, setFocus] = useState(planningWeek);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cooking, setCooking] = useState<PlannedRecipe | null>(null);
  const board = useWeekBoard(focus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const next = addWeeks(focus, 1);
  const planned = new Set(
    board.weeks
      .filter((w) => w.week_of === focus || w.week_of === next)
      .flatMap((w) => w.recipes.map((r) => r.id)),
  );
  const bringBackTo = planningWeek();

  // Both ways of adding from outside the board land you back on it, so you
  // can see where the recipe went.
  const addAndShow = async (dbId: number, week: string) => {
    await board.add(dbId, week);
    setView("week");
  };

  return (
    <div className="app">
      <Spine view={view} onView={setView} onSearch={() => setSearchOpen(true)} />

      {/* Both views stay mounted so a cart run or a merge survives switching. */}
      <div className="view" hidden={view !== "week"}>
        <WeekBoard
          focus={focus}
          setFocus={setFocus}
          board={board}
          keysActive={view === "week" && !searchOpen && !cooking}
          onCook={setCooking}
        />
        <ListRail focus={focus} week={board.weeks.find((w) => w.week_of === focus)} board={board} />
      </div>
      <div className="view" hidden={view !== "rotation"}>
        <Rotation
          active={view === "rotation"}
          bringBackTo={bringBackTo}
          onBringBack={(dbId) => addAndShow(dbId, bringBackTo)}
        />
      </div>

      {searchOpen && (
        <SearchOverlay focus={focus} planned={planned} onAdd={addAndShow} onClose={() => setSearchOpen(false)} />
      )}
      {cooking && <CookMode recipe={cooking} onClose={() => setCooking(null)} />}
    </div>
  );
}

export default App;
