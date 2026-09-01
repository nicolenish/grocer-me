import { useState, useEffect, useRef } from "react";
import type { PantryItem } from "../types";
import { listPantry, addPantryItem, deletePantryItem, updatePantryItem } from "../api";
import { titleCase } from "../utils";

function timeAgoDate(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso + "T00:00:00").getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 0) return "recently";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  if (weeks < 4) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

const CATEGORY_CONFIG: Record<string, { emoji: string; label: string }> = {
  pantry: { emoji: "🫙", label: "Pantry Staples" },
  sauce: { emoji: "🥫", label: "Sauces & Condiments" },
  spice: { emoji: "🧂", label: "Spices & Seasonings" },
  oil: { emoji: "🫒", label: "Oils & Vinegars" },
  dairy: { emoji: "🧈", label: "Dairy" },
  other: { emoji: "📦", label: "Other" },
};

export default function Fridge() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("pantry");
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    loadItems();
  }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await listPantry();
      setItems(data);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const item = await addPantryItem(name, newCategory);
      setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
    } catch { /* */ }
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePantryItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { /* */ }
  };

  const handleMarkBought = async (id: number) => {
    const today = new Date().toISOString().split("T")[0];
    try {
      const updated = await updatePantryItem(id, { last_bought: today });
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch { /* */ }
  };

  const handleToggleSkip = async (item: PantryItem) => {
    try {
      const updated = await updatePantryItem(item.id, { auto_skip: !item.auto_skip });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch { /* */ }
  };

  const grouped = Object.entries(CATEGORY_CONFIG)
    .map(([key, config]) => ({
      key,
      ...config,
      items: items.filter((i) => i.category === key),
    }))
    .filter((g) => g.items.length > 0);

  // Items with categories not in config
  const otherItems = items.filter((i) => !CATEGORY_CONFIG[i.category]);
  if (otherItems.length > 0) {
    grouped.push({
      key: "uncategorized",
      emoji: "📦",
      label: "Other",
      items: otherItems,
    });
  }

  if (loading) {
    return (
      <div className="step-content">
        <div className="empty-state">
          <div className="empty-icon">🧊</div>
          <p className="subtitle">Loading your pantry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="step-content">
      <div className="section-header">
        <h2>My Fridge & Pantry</h2>
        <p className="subtitle">
          Items you already have at home. These will be auto-skipped when building grocery lists.
        </p>
      </div>

      <div className="pantry-add-form">
        <input
          type="text"
          placeholder="Add item (e.g. soy sauce, sesame oil...)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="search-input"
        />
        <div className="pantry-add-row">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="pantry-select"
          >
            {Object.entries(CATEGORY_CONFIG).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <button onClick={handleAdd} className="btn-primary btn-sm">
            Add to Pantry
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state" style={{ padding: "24px 0" }}>
          <div className="empty-icon">🧊</div>
          <p className="subtitle">
            No pantry items yet. Add sauces, spices, and staples you already have at home.
          </p>
        </div>
      ) : (
        <div className="pantry-groups">
          {grouped.map((group) => (
            <div key={group.key} className="pantry-group">
              <h3 className="category-label">
                <span className="category-emoji">{group.emoji}</span>
                {group.label}
                <span className="category-count">{group.items.length}</span>
              </h3>
              <div className="pantry-items">
                {group.items.map((item) => (
                  <div key={item.id} className="pantry-item">
                    <div className="pantry-item-info">
                      <span className="pantry-item-name">{titleCase(item.name)}</span>
                      <span className="pantry-item-bought">
                        {item.last_bought
                          ? `bought ${timeAgoDate(item.last_bought)}`
                          : "never tracked"}
                      </span>
                    </div>
                    <div className="pantry-item-actions">
                      <button
                        onClick={() => handleToggleSkip(item)}
                        className={`pantry-toggle ${item.auto_skip ? "active" : ""}`}
                        title={item.auto_skip ? "Auto-skipping on grocery list" : "Will appear on grocery list"}
                      >
                        {item.auto_skip ? "Auto-skip" : "Include"}
                      </button>
                      <button
                        onClick={() => handleMarkBought(item.id)}
                        className="btn-ghost btn-sm"
                        title="Mark as just bought"
                      >
                        Bought today
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="btn-x"
                        style={{ color: "var(--text-muted)" }}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
