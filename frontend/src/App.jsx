import { useEffect, useState } from "react";
import TrendChart from "./TrendChart.jsx";
import VolumeChart from "./VolumeChart.jsx";
import MuniTable from "./MuniTable.jsx";
import QualityPanel from "./QualityPanel.jsx";
import Chat from "./Chat.jsx";
import MapView from "./MapView.jsx";
import { fmtMoney, fmtInt } from "./format.js";

const MAX_COMPARE = 2; // county + 2 places = 3 series, the all-pairs-safe palette limit

export default function App() {
  const [armsLength, setArmsLength] = useState(true);
  const [overview, setOverview] = useState(null);
  // Fixed slots so each place keeps its color when another is removed.
  const [compare, setCompare] = useState(["Pittsburgh", null]);
  const [error, setError] = useState(null);
  const [chatPrompt, setChatPrompt] = useState(null); // {text, n}: a question sent from elsewhere on the page
  // Year range applied to every panel; defaults to full years (the latest year is partial).
  const [years, setYears] = useState([2016, 2025]);

  useEffect(() => {
    const q = new URLSearchParams({ arms_length_only: armsLength, year_from: years[0], year_to: years[1] });
    fetch(`/api/overview?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setOverview)
      .catch(() => setError("Can't reach the API. Is the backend running on port 8000?"));
  }, [armsLength, years]);

  // The map only adds (clicking an already-charted place keeps it charted).
  const selectPlace = (name) => setCompare((c) => (c.includes(name) ? c : place(c, name)));
  const place = (c, name) => {
    const free = c.indexOf(null);
    const next = [...c];
    next[free === -1 ? MAX_COMPARE - 1 : free] = name;
    return next;
  };

  const toggleCompare = (name) =>
    setCompare((c) => {
      if (c.includes(name)) return c.map((x) => (x === name ? null : x));
      const free = c.indexOf(null);
      const next = [...c];
      next[free === -1 ? MAX_COMPARE - 1 : free] = name;
      return next;
    });

  const change = overview?.change;
  const partial = overview && years[1] >= overview.partial_year;

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Allegheny County property sales</h1>
          <p className="sub">
            {overview
              ? `${fmtInt(overview.total_records)} cleaned records · ${overview.municipalities} municipalities · ${overview.date_range[0]} to ${overview.date_range[1]}`
              : "Loading…"}
          </p>
        </div>
      </header>

      <FilterBar
        armsLength={armsLength}
        setArmsLength={setArmsLength}
        years={years}
        setYears={setYears}
        available={overview?.available_years ?? [2016, 2026]}
      />

      {error && <div className="banner">{error}</div>}

      <div className="layout">
        <main>
          <section className="tiles">
            <Tile
              label={overview ? `Median sale price, ${overview.median_year}` : "Median sale price"}
              value={overview && fmtMoney(overview.median_price)}
              note={overview && overview.median_year >= overview.partial_year ? "Partial year" : "Last year of range"}
            />
            <Tile
              label={change ? `Median change ${change.from_year}–${change.to_year}` : "Median change"}
              value={change && `${change.pct_change > 0 ? "+" : ""}${change.pct_change}%`}
              note={change && `${fmtMoney(change.median_from)} → ${fmtMoney(change.median_to)}`}
            />
            <Tile
              label={`Sales, ${years[0]}–${years[1]}`}
              value={overview && fmtInt(overview.filtered_sales)}
              note={armsLength ? "Assessor-validated only" : "Every sale ≥ $10k"}
            />
            <Tile label="Places" value={overview && overview.municipality_groups} note="Wards rolled up to cities" />
          </section>
          {partial && <p className="note">{overview.partial_year_note}</p>}

          <MapView
            armsLength={armsLength}
            years={years}
            selected={compare}
            onSelectPlace={selectPlace}
            onAsk={(text) => setChatPrompt({ text, n: Date.now() })}
          />
          <TrendChart places={compare} armsLength={armsLength} years={years} onRemove={toggleCompare} />
          <VolumeChart armsLength={armsLength} years={years} />
          <MuniTable armsLength={armsLength} years={years} selected={compare} onToggle={toggleCompare} max={MAX_COMPARE} />
          <QualityPanel />
        </main>
        <Chat prompt={chatPrompt} />
      </div>
    </div>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value ?? "—"}</div>
      {note && <div className="tile-note">{note}</div>}
    </div>
  );
}

function FilterBar({ armsLength, setArmsLength, years, setYears, available }) {
  const all = [];
  for (let y = available[0]; y <= available[1]; y++) all.push(y);
  const full = available[1] - 1;
  const presets = [
    ["All full years", [available[0], full]],
    ["Pre-pandemic", [available[0], 2019]],
    ["Since 2020", [2020, full]],
    ["Last 3 years", [full - 2, full]],
  ];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  return (
    <div className="filterbar" role="toolbar" aria-label="Filters">
      <div className="filter-group">
        <span className="filter-label">Sales</span>
        <div className="seg small" role="group" aria-label="Which sales to include">
          <button className={armsLength ? "on" : ""} onClick={() => setArmsLength(true)}>
            Arm's-length
          </button>
          <button className={!armsLength ? "on" : ""} onClick={() => setArmsLength(false)}>
            All priced
          </button>
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-label">Years</span>
        <select
          aria-label="From year"
          value={years[0]}
          onChange={(e) => {
            const a = Number(e.target.value);
            setYears([a, Math.max(a, years[1])]);
          }}
        >
          {all.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="muted">to</span>
        <select
          aria-label="To year"
          value={years[1]}
          onChange={(e) => {
            const b = Number(e.target.value);
            setYears([Math.min(years[0], b), b]);
          }}
        >
          {all.map((y) => (
            <option key={y} value={y}>
              {y}
              {y === available[1] ? " (partial)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-group presets">
        {presets.map(([label, r]) => (
          <button key={label} className={`chip ${same(r, years) ? "on" : ""}`} onClick={() => setYears(r)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
