import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtInt, fmtMoney } from "./format.js";

export default function VolumeChart({ armsLength, years }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetch(`/api/trend?granularity=quarter&arms_length_only=${armsLength}&year_from=${years[0]}&year_to=${years[1]}`)
      .then((r) => r.json())
      .then(setRows);
  }, [armsLength, years]);

  const last = rows.at(-1);

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Sales per quarter, countywide</h2>
          <p className="card-sub">
            Volume shows seasonality and how much data sits behind each median.
            {last && years[1] >= 2026 && ` ${last.group} is incomplete.`}
          </p>
        </div>
      </div>
      <div className="chart">
        <ResponsiveContainer width="99%" height={200}>
          <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="group"
              tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--grid)" }}
              interval={years[1] - years[0] > 5 ? 3 : 1}
              tickFormatter={(p) => (years[1] - years[0] > 5 ? p.slice(0, 4) : p)}
            />
            <YAxis
              tickFormatter={fmtInt}
              tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "var(--hover)" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="tip">
                    <div className="tip-title">{payload[0].payload.group}</div>
                    <div>{fmtInt(payload[0].payload.sales)} sales</div>
                    <div className="muted">Median {fmtMoney(payload[0].payload.median_price)}</div>
                  </div>
                ) : null
              }
            />
            <Bar dataKey="sales" fill="var(--series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
