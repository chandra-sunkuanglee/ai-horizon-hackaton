import { useEffect, useMemo, useState } from "react";
import { fmtInt, fmtMoney } from "./format.js";

const COLUMNS = [
  { key: "municipality", label: "Place", num: false },
  { key: "sales", label: "Sales", num: true },
  { key: "median_price", label: "Median price", num: true },
  { key: "change_pct", label: "Change", num: true },
];

export default function MuniTable({ armsLength, years, selected, onToggle, max }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "sales", dir: -1 });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch(`/api/municipalities?arms_length_only=${armsLength}&year_from=${years[0]}&year_to=${years[1]}`)
      .then((r) => r.json())
      .then(setRows);
  }, [armsLength, years]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => !q || r.municipality.toLowerCase().includes(q));
    out.sort((a, b) => {
      const va = a[sort.key] ?? -Infinity;
      const vb = b[sort.key] ?? -Infinity;
      return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
    });
    return out;
  }, [rows, search, sort]);

  const shown = showAll || search ? visible : visible.slice(0, 15);
  const span = rows[0]?.change_span ?? "";

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Municipalities</h2>
          <p className="card-sub">
            {years[0]}–{years[1]}, wards rolled up to their city.{" "}
            {span ? `Change compares median price ${span}; places need 30+ sales in both periods.` : "Pick 2+ years to see change."}{" "}
            Select a row to chart it (up to {max}).
          </p>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search places"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table className="muni">
          <thead>
            <tr>
              <th aria-label="Chart" />
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.num ? "num sortable" : "sortable"}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : c.num ? -1 : 1 }))}
                  aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const on = selected.includes(r.municipality);
              return (
                <tr key={r.municipality} className={on ? "sel" : ""} onClick={() => onToggle(r.municipality)}>
                  <td>
                    <input type="checkbox" readOnly checked={on} aria-label={`Chart ${r.municipality}`} />
                  </td>
                  <td>
                    {r.municipality}
                    {r.low_sample && <span className="badge" title="Fewer than 30 sales">low sample</span>}
                  </td>
                  <td className="num">{fmtInt(r.sales)}</td>
                  <td className="num">{fmtMoney(r.median_price)}</td>
                  <td className="num">
                    {r.change_pct == null ? (
                      <span className="muted" title="Too few sales in one of the years">n/a</span>
                    ) : (
                      `${r.change_pct > 0 ? "+" : ""}${r.change_pct}%`
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!search && visible.length > 15 && (
        <button className="link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${visible.length}`}
        </button>
      )}
    </section>
  );
}
