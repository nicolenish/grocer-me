import { useState } from "react";
import type { GroceryItem, WeeeCartResult, WeeeLoginStatus } from "../types";
import { addToWeeeCart, getWeeeLoginStatus, weeeLogin } from "../api";
import { titleCase } from "../utils";

interface Props {
  groceryItems: GroceryItem[];
  checked: Record<string, boolean>;
  loginStatus: WeeeLoginStatus | null;
  setLoginStatus: (s: WeeeLoginStatus) => void;
  results: WeeeCartResult[];
  setResults: (r: WeeeCartResult[]) => void;
  message: string | null;
  setMessage: (m: string | null) => void;
}

export default function WeeeCart({
  groceryItems,
  checked,
  loginStatus,
  setLoginStatus,
  results,
  setResults,
  message,
  setMessage,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLogin = async () => {
    setLoginLoading(true);
    try {
      const status = await getWeeeLoginStatus();
      setLoginStatus(status);
    } catch {
      setLoginStatus({ logged_in: false, message: "Could not check login status" });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setError(null);
    try {
      const status = await weeeLogin();
      setLoginStatus(status);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
    } finally {
      setLoginLoading(false);
    }
  };

  const itemsToCart = groceryItems.filter((item, index) => {
    const key = `${item.category || "other"}-${index}`;
    return !item.in_pantry && !checked[key];
  });

  const handleAddToCart = async () => {
    if (itemsToCart.length === 0) {
      setError("No items to add — everything is already in your pantry!");
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setMessage(null);

    try {
      const response = await addToWeeeCart(itemsToCart);
      setResults(response.results);
      setMessage(response.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add items to cart";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "added": return "✓";
      case "not_found": return "✗";
      case "error": return "!";
      default: return "?";
    }
  };

  const statusClass = (s: string) => {
    switch (s) {
      case "added": return "status-added";
      case "not_found": case "no_add_button": case "error": return "status-not-found";
      default: return "status-pending";
    }
  };

  if (!loginStatus) {
    return (
      <div className="step-content">
        <h2>Weee! Cart</h2>
        <p className="subtitle">Checking login status...</p>
      </div>
    );
  }

  return (
    <div className="step-content">
      <h2>Weee! Cart</h2>

      {!loginStatus.logged_in ? (
        <div className="login-section">
          <p className="subtitle">
            Connect your Weee! account to add items to your cart automatically.
            A browser window will open for you to sign in.
          </p>
          <button
            onClick={handleLogin}
            disabled={loginLoading}
            className="btn-primary"
          >
            {loginLoading
              ? "Waiting for login... (check the browser window)"
              : "Sign in to Weee!"}
          </button>
          <button onClick={refreshLogin} disabled={loginLoading} className="btn-secondary" style={{ marginLeft: 8 }}>
            Refresh Status
          </button>
        </div>
      ) : (
        <>
          <p className="subtitle">
            Signed in to Weee! — {itemsToCart.length} items to add to your cart.
            {groceryItems.length - itemsToCart.length > 0 && (
              <> ({groceryItems.length - itemsToCart.length} pantry items skipped)</>
            )}
          </p>

          <button
            onClick={handleAddToCart}
            disabled={loading || itemsToCart.length === 0}
            className="btn-primary"
          >
            {loading ? "Adding to Cart... (browser is working)" : `Add ${itemsToCart.length} Items to Weee! Cart`}
          </button>

          {loading && (
            <p className="info">
              Playwright is searching and adding items. This may take a minute — do not close the browser window.
            </p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      {results.length > 0 && (
        <div className="cart-results">
          <h3>Results</h3>
          <ul className="result-list">
            {results.map((result, idx) => (
              <li key={idx} className="result-item">
                <span className={`status-badge ${statusClass(result.status)}`}>
                  {statusIcon(result.status)}
                </span>
                <span className="result-name">{titleCase(result.name)}</span>
                {result.matched_product && (
                  <span className="matched-product">→ {result.matched_product}</span>
                )}
                <span className="result-message">{result.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
