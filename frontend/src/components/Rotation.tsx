import { useEffect, useState } from "react";
import type { Rotation as RotationData } from "../types";
import { getRotation } from "../api";
import { errorMessage, pad2, percent, shortDate } from "../utils";

const WINDOW_WEEKS = 26;
const TOP_SHADES = ["var(--accent)", "var(--acc2)", "var(--acc3)"];

const agoShort = (weeks: number) => (weeks === 0 ? "this wk" : `${weeks}w ago`);

/** "Easy Char Siu Chicken (Sticky…)" → "Easy Char Siu Chic…", for tight legends. */
function shortTitle(title: string): string {
  const plain = title.replace(/\s*\(.*?\)\s*/g, " ").trim();
  return plain.length > 18 ? `${plain.slice(0, 17)}…` : plain;
}

interface Props {
  active: boolean;
  /** The week "bring one back" puts a recipe on. */
  bringBackTo: string;
  onBringBack: (dbId: number) => Promise<void>;
}

/** What the last six months of plans add up to. */
export default function Rotation({ active, bringBackTo, onBringBack }: Props) {
  const [data, setData] = useState<RotationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviving, setReviving] = useState<number | null>(null);

  // Recount every time the view opens: the week board may have changed things.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    getRotation(WINDOW_WEEKS)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Couldn't count the dinners."));
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const revive = async (dbId: number) => {
    setReviving(dbId);
    try {
      await onBringBack(dbId);
    } finally {
      setReviving(null);
    }
  };

  return (
    <section className="rot">
      <div className="rot-top">
        <div className="rot-heading">
          <span className="rot-title">Rotation</span>
          {data && (
            <span className="rot-range">
              {shortDate(data.range.start)} — {shortDate(data.range.end)} · {data.range.weeks} weeks
            </span>
          )}
        </div>
        {data && (
          <div className="rot-stats">
            <Stat n={data.dinners} label="dinners" />
            <span className="stat-rule" />
            <Stat n={data.distinct} label="distinct" />
            <span className="stat-rule" />
            <Stat n={data.avg_repeats.toFixed(1)} label="avg repeats" />
            <span className="stat-rule" />
            <Stat n={data.overcooked} label="overcooked" accent />
          </div>
        )}
      </div>

      {!data ? (
        <p className="rot-empty">{error ?? "counting dinners…"}</p>
      ) : (
        <div className="rot-body">
          <div className="panel rot-chart">
            <div className="panel-head">
              <span className="label">Times cooked</span>
              <span className="label-note">dashed line = once a month</span>
            </div>
            <TimesCooked data={data} />
          </div>

          <div className="rot-side">
            <Concentration data={data} />
            <TooOften data={data} />
            <ProteinMix data={data} />
            <div className="panel panel--grow">
              <span className="label">Gone cold · bring one back</span>
              {data.gone_cold.length ? (
                <div className="cold-list">
                  {data.gone_cold.map((r) => (
                    <div key={r.id} className="cold-row">
                      <span className="cold-title">{r.title}</span>
                      <span className="cold-ago" title={`last planned ${r.weeks_ago} weeks ago · ${r.times}× in all`}>
                        {r.weeks_ago}w
                      </span>
                      <button
                        className="cold-add"
                        onClick={() => revive(r.id)}
                        disabled={reviving !== null}
                        aria-label={`Put ${r.title} on the week of ${shortDate(bringBackTo)}`}
                      >
                        {reviving === r.id ? "…" : "＋"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel-empty">Nothing has gone cold. Everything you've cooked was on a plan in the last six weeks.</p>
              )}
              <div className="panel-foot">＋ drops it into week of {shortDate(bringBackTo)}</div>
            </div>
          </div>
        </div>
      )}
      {data && error && <p className="rot-error">{error}</p>}
    </section>
  );
}

function Stat({ n, label, accent }: { n: number | string; label: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className={`stat-n${accent ? " is-accent" : ""}`}>{n}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

function TimesCooked({ data }: { data: RotationData }) {
  const rows = data.times_cooked;
  if (!rows.length) return <p className="panel-empty">No dinners in this window yet. Plan a few weeks and this fills in.</p>;

  // The axis always reaches the once-a-month line, so a spread-out rotation
  // reads as short bars well under it rather than bars that fill the width.
  const max = Math.max(Math.ceil(data.once_a_month), ...rows.map((r) => r.count), 1);
  const step = max <= 10 ? 2 : Math.ceil(max / 5);
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  const at = (n: number) => `${(n / max) * 100}%`;

  return (
    <div className="tc">
      <div className="tc-plot">
        <div className="tc-grid" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className={`tc-line${t === 0 ? " is-zero" : ""}`} style={{ left: at(t) }} />
          ))}
          <span className="tc-line is-month" style={{ left: at(data.once_a_month) }} />
        </div>

        {rows.map((r) => (
          <div
            key={r.id}
            className="tc-row"
            aria-label={`${r.title}: ${r.count} times, last ${agoShort(r.weeks_ago)}`}
          >
            <div className="tc-label" title={r.title}>{r.title}</div>
            <div className="tc-track">
              <div className="tc-bar" style={{ width: at(r.count) }} />
              <div className="tc-tip">
                {r.count}× in {data.range.weeks} weeks · last {agoShort(r.weeks_ago)}
                {r.over ? " · more than once a month" : ""}
              </div>
            </div>
            <div className="tc-val">
              <span className={`tc-n${r.over ? " is-over" : ""}`}>{r.count}</span>
              <span className="tc-ago">{agoShort(r.weeks_ago)}</span>
            </div>
          </div>
        ))}

        <div className="tc-axis" aria-hidden="true">
          <span />
          <div className="tc-ticks">
            {ticks.map((t) => (
              <span key={t} style={{ left: at(t) }}>{t}</span>
            ))}
          </div>
          <span />
        </div>
      </div>
      {data.times_cooked_hidden > 0 && (
        <div className="tc-more">+ {data.times_cooked_hidden} more, cooked less often</div>
      )}
    </div>
  );
}

function Concentration({ data }: { data: RotationData }) {
  const { top, top_share } = data.concentration;
  const rest = Math.max(1 - top_share, 0);
  return (
    <div className="panel">
      <span className="label">Concentration</span>
      <div className="big-row">
        <span className="big-n">{data.dinners ? percent(top_share) : "—"}</span>
        <span className="big-cap">of dinners were your top {top.length || 3}</span>
      </div>
      {data.dinners > 0 && (
        <>
          <div className="stack">
            {top.map((t, i) => (
              <div
                key={t.id}
                style={{ flex: t.share * 1000, background: TOP_SHADES[i] }}
                title={`${t.title} · ${t.count} dinners · ${percent(t.share)}`}
              />
            ))}
            {rest > 0 && (
              <div style={{ flex: rest * 1000, background: "var(--line)" }} title={`everything else · ${percent(rest)}`} />
            )}
          </div>
          <div className="stack-legend">
            {top.map((t, i) => (
              <span key={t.id} title={t.title}>
                <i style={{ background: TOP_SHADES[i] }} />
                {shortTitle(t.title)} {percent(t.share)}
              </span>
            ))}
            <span>
              <i style={{ background: "var(--line)" }} />
              rest {percent(rest)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function TooOften({ data }: { data: RotationData }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">Too often</span>
        <span className="label-note">{pad2(data.too_often.length)}</span>
      </div>
      {data.too_often.length ? (
        <div className="flags">
          {data.too_often.map((t) => (
            <div key={t.id} className="flag">
              <div className="flag-title">{t.title}</div>
              <div className="flag-note">{t.note}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-empty">
          Nothing past once a month ({data.once_a_month} in {data.range.weeks} weeks). A good spread.
        </p>
      )}
    </div>
  );
}

function ProteinMix({ data }: { data: RotationData }) {
  return (
    <div className="panel">
      <span className="label">Protein mix</span>
      {data.protein_mix.length ? (
        <div className="pm-list">
          {data.protein_mix.map((p, i) => (
            <div key={p.label} className="pm-row" title={`${p.label} · ${p.count} dinners`}>
              <span className="pm-label">{p.label}</span>
              <div className="pm-track">
                <div className="pm-fill" style={{ width: percent(p.share) }} />
              </div>
              <span className={`pm-pct${i === 0 ? " is-accent" : ""}`}>{percent(p.share)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-empty">No dinners to sort yet.</p>
      )}
    </div>
  );
}
