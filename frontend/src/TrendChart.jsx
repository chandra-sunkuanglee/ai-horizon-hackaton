import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SERIES, fmtInt, fmtMoney, fmtMoneyShort } from "./format.js";

const COUNTY = "All of Allegheny County";

export default function TrendChart({ places, armsLength, years, onRemove }) {
  const [granularity, setGranularity] = useState("quarter");
  const [series, setSeries] = useState([]); // [{name, color, rows}]
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    // Slot 0 is the county; place slots keep their index so colors follow the place.
    const slots = [COUNTY, ...places];
    Promise.all(
      slots.map((name, i) => {
        if (!name) return null;
        const q = new URLSearchParams({
          granularity,
          arms_length_only: armsLength,
          year_from: years[0],
          year_to: years[1],
        });
        if (name !== COUNTY) q.set("municipality", name);
        return fetch(`/api/trend?${q}`)
          .then((r) => r.json())
          .then((rows) => ({ name, color: SERIES[i], key: `s${i}`, rows }));
      })
    ).then((res) => setSeries(res.filter(Boolean)));
  }, [places, granularity, armsLength, years]);

  // Merge into one row per period: {period, s0, s0_n, s1, ...}
  const byPeriod = new Map();
  for (const s of series) {
    for (const r of s.rows) {
      const row = byPeriod.get(r.group) ?? { period: r.group };
      row[s.key] = r.median_price;
      row[`${s.key}_n`] = r.sales;
      byPeriod.set(r.group, row);
    }
  }
  const data = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Median sale price over time</h2>
          <p className="card-sub">Pick up to two places in the table below to compare with the county.</p>
        </div>
        <div className="card-tools">
          <div className="seg small">
            {["year", "quarter"].map((g) => (
              <button key={g} className={granularity === g ? "on" : ""} onClick={() => setGranularity(g)}>
                {g === "year" ? "Yearly" : "Quarterly"}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      <ul className="legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className="swatch line" style={{ background: s.color }} />
            {s.name}
            {s.name !== COUNTY && (
              <button className="x" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.name)}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {showTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                {series.map((s) => (
                  <th key={s.key} className="num">{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {fmtMoney(row[s.key])} <span className="muted">({fmtInt(row[`${s.key}_n`])})</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart">
          <ResponsiveContainer width="99%" height={300}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="period"
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--grid)" }}
                interval={granularity === "quarter" ? (years[1] - years[0] > 5 ? 3 : 1) : 0}
                tickFormatter={(p) => (granularity === "quarter" && years[1] - years[0] > 5 ? p.slice(0, 4) : p)}
              />
              <YAxis
                tickFormatter={fmtMoneyShort}
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip content={<TrendTooltip series={series} />} cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2, fill: s.color }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="foot">
        Hover a point for its sample size. Points with fewer than 30 sales are marked "low sample" and are noisy.
      </p>
    </section>
  );
}

function TrendTooltip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-title">{label}</div>
      {series.map((s) =>
        row[s.key] == null ? null : (
          <div key={s.key} className="tip-row">
            <span className="swatch" style={{ background: s.color }} />
            <span className="tip-name">{s.name}</span>
            <span className="tip-val">{fmtMoney(row[s.key])}</span>
            <span className="muted">
              {fmtInt(row[`${s.key}_n`])} sales{row[`${s.key}_n`] < 30 ? " · low sample" : ""}
            </span>
          </div>
        )
      )}
    </div>
  );
}
