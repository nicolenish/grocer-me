export type View = "week" | "rotation";

interface Props {
  view: View;
  onView: (view: View) => void;
  onSearch: () => void;
}

/** The narrow bar down the left: the two views, and search. */
export default function Spine({ view, onView, onSearch }: Props) {
  return (
    <nav className="spine">
      <div className="spine-top">
        <div className="spine-mark" aria-hidden="true" />
        <div className="spine-nav">
          <button
            className={view === "week" ? "on" : ""}
            onClick={() => onView("week")}
            title="The week"
            aria-label="The week"
            aria-current={view === "week" ? "page" : undefined}
          >
            W
          </button>
          <button
            className={view === "rotation" ? "on" : ""}
            onClick={() => onView("rotation")}
            title="Rotation"
            aria-label="Rotation"
            aria-current={view === "rotation" ? "page" : undefined}
          >
            R
          </button>
        </div>
      </div>
      <div className="spine-word">grocer me</div>
      <div className="spine-bottom">
        <button
          className="spine-search"
          onClick={onSearch}
          title="Search everything you've cooked"
          aria-label="Search everything you've cooked"
        >
          ⌕
        </button>
        <span className="spine-kbd">⌘K</span>
      </div>
    </nav>
  );
}
