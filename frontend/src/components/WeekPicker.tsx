import { addWeeks, formatWeekRange, mondayOf, weekRelativeLabel } from "../utils";

interface Props {
  weekOf: string;
  setWeekOf: (iso: string) => void;
}

/** Pick which Monday-start week you're planning for. Weeks you skip stay empty. */
export default function WeekPicker({ weekOf, setWeekOf }: Props) {
  const isThisWeek = weekOf === mondayOf();
  return (
    <div className="week-picker">
      <span className="week-picker-caption">Planning for</span>
      <div className="week-picker-controls">
        <button
          className="week-nav-btn"
          onClick={() => setWeekOf(addWeeks(weekOf, -1))}
          title="Previous week"
          aria-label="Previous week"
        >
          ◀
        </button>
        <div className="week-picker-label">
          <span className="week-range">{formatWeekRange(weekOf)}</span>
          <span className="week-relative">{weekRelativeLabel(weekOf)}</span>
        </div>
        <button
          className="week-nav-btn"
          onClick={() => setWeekOf(addWeeks(weekOf, 1))}
          title="Next week"
          aria-label="Next week"
        >
          ▶
        </button>
      </div>
      {!isThisWeek && (
        <button className="week-today-btn" onClick={() => setWeekOf(mondayOf())}>
          Jump to this week
        </button>
      )}
    </div>
  );
}
