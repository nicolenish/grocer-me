import { useEffect, useRef, useState } from "react";
import type { CartResponse, CartRun, GroceryItem, StoreStatus } from "../types";
import { fillCart, getStoreStatus, storeLogin } from "../api";
import { errorMessage } from "../utils";

interface Props {
  focus: string;
  buy: GroceryItem[];
  /** Why the cart can't run right now, if it can't. */
  blocked: string | null;
  lastRun: CartRun | null;
  onRun: () => void;
}

const unmatchedLine = (r: { name: string; status: string; message: string }) =>
  `${r.name.toLowerCase()} — ${r.message || r.status.replace(/_/g, " ")}`;

/** Pushes the list into the store's cart. Stops at the cart; checkout stays with you. */
export default function CartPanel({ focus, buy, blocked, lastRun, onRun }: Props) {
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ week: string; res: CartResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const didCheck = useRef(false);

  // Checking the login opens a headless browser, so do it once, not per render.
  useEffect(() => {
    if (didCheck.current) return;
    didCheck.current = true;
    getStoreStatus()
      .then(setStatus)
      .catch(() => setStatus({ logged_in: false, message: "Couldn't check the store login." }));
  }, []);

  const store = status?.store ?? "Weee!";
  const done = !running && result?.week === focus ? result.res : null;

  const run = async () => {
    const week = focus;
    setRunning(true);
    setError(null);
    try {
      const res = await fillCart(buy, week);
      if (res.results.length) {
        setResult({ week, res });
        onRun();
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError(errorMessage(err, "The cart run failed."));
    } finally {
      setRunning(false);
    }
  };

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      setStatus(await storeLogin());
    } catch (err) {
      setError(errorMessage(err, "Sign-in didn't finish."));
    } finally {
      setSigningIn(false);
    }
  };

  const title = running
    ? `${store} · playwright running`
    : done
      ? `${store} · finished`
      : !status
        ? `${store} · checking…`
        : status.logged_in
          ? `${store} · signed in`
          : `${store} · not signed in`;

  let body;
  if (running) {
    body = (
      <div className="cart-box">
        <div className="cart-box-head">
          <span className="cart-box-title">Working through the list</span>
          <span className="cart-box-n">{buy.length} items</span>
        </div>
        <div className="sweep" aria-hidden="true" />
        <div className="cart-note">a chromium window is open — hovering each card, then clicking add. don't close it.</div>
      </div>
    );
  } else if (done) {
    const unmatched = done.results.filter((r) => r.status !== "added");
    body = (
      <div className="cart-box">
        <div className="cart-box-head">
          <span className="cart-box-title cart-box-title--big">In the cart</span>
          <span className="cart-box-n">
            {done.results.length - unmatched.length} of {done.results.length}
          </span>
        </div>
        {unmatched.length > 0 && (
          <div className="cart-unmatched">
            {unmatched.map((r) => <div key={r.name}>{unmatchedLine(r)}</div>)}
          </div>
        )}
        <div className="cart-actions">
          <button className="btn" onClick={() => setResult(null)}>Run again</button>
          {status?.cart_url && (
            <a className="btn btn--accent" href={status.cart_url} target="_blank" rel="noopener noreferrer">
              Open cart
            </a>
          )}
        </div>
      </div>
    );
  } else if (status && !status.logged_in) {
    body = (
      <>
        <button className="cart-go" onClick={signIn} disabled={signingIn}>
          <span>{signingIn ? "Waiting for sign-in…" : `Sign in to ${store}`}</span>
          <span className="cart-go-n">→</span>
        </button>
        <div className="cart-meta">
          <span>{signingIn ? "finish in the browser window that opened" : "opens a browser once; the session is saved"}</span>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <button className="cart-go" onClick={run} disabled={!status || !buy.length || !!blocked}>
          <span>Fill the cart</span>
          <span className="cart-go-n">{buy.length} →</span>
        </button>
        <div className="cart-meta">
          {blocked ? (
            <span>{blocked}</span>
          ) : lastRun ? (
            <>
              <span>last run {lastRun.added}/{lastRun.total}</span>
              {lastRun.unmatched.length > 0 && (
                <button onClick={() => setShowUnmatched((s) => !s)} aria-expanded={showUnmatched}>
                  {lastRun.unmatched.length} unmatched {showUnmatched ? "‹" : "›"}
                </button>
              )}
            </>
          ) : (
            <span>not run for this week yet</span>
          )}
        </div>
        {showUnmatched && lastRun && lastRun.unmatched.length > 0 && (
          <div className="cart-unmatched">
            {lastRun.unmatched.map((r) => <div key={r.name}>{unmatchedLine(r)}</div>)}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="cart">
      <div className="cart-head">
        <span className="cart-title">{title}</span>
        <span className={running ? "dot is-running" : status?.logged_in ? "dot" : "dot is-off"} />
      </div>
      {body}
      {error && <div className="cart-error">{error}</div>}
    </div>
  );
}
