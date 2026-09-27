import { useEffect, useState } from "react";
import { fmtInt, fmtMoney } from "./format.js";

export default function QualityPanel() {
  const [q, setQ] = useState(null);

  useEffect(() => {
    fetch("/api/quality").then((r) => r.json()).then(setQ);
  }, []);

  if (!q) return null;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Data quality</h2>
          <p className="card-sub">
            {fmtInt(q.raw_rows)} raw county records → {fmtInt(q.clean_rows)} cleaned →{" "}
            {fmtInt(q.arms_length_rows)} assessor-validated arm's-length sales.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cleaning step</th>
              <th className="num">Removed</th>
              <th className="num">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {q.cleaning_steps
              .filter((s) => s.removed > 0)
              .map((s) => (
                <tr key={s.step}>
                  <td>
                    {s.step}
                    <div className="muted small">{s.note}</div>
                  </td>
                  <td className="num">{fmtInt(s.removed)}</td>
                  <td className="num">{fmtInt(s.remaining)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h3>Caveats</h3>
      <ul className="caveats">
        {[q.partial_year_note, ...q.caveats].map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {q.arms_length_by_year && (
        <details>
          <summary>Arm's-length coverage by year</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num">Priced sales</th>
                  <th className="num">Arm's-length</th>
                  <th className="num">Share</th>
                  <th className="num">Median, all priced</th>
                  <th className="num">Median, arm's-length</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(q.arms_length_by_year).map(([y, v]) => (
                  <tr key={y}>
                    <td>{y}</td>
                    <td className="num">{fmtInt(v.priced_sales)}</td>
                    <td className="num">{fmtInt(v.arms_length_sales)}</td>
                    <td className="num">{Math.round(v.arms_length_share * 100)}%</td>
                    <td className="num">{fmtMoney(v.median_all_priced)}</td>
                    <td className="num">{fmtMoney(v.median_arms_length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details>
        <summary>Sale codes in the cleaned data</summary>
        <div className="table-wrap">
          <table>
            <tbody>
              {q.sale_code_breakdown.map((s) => (
                <tr key={s.code + s.description}>
                  <td>{s.description || s.code}</td>
                  <td className="num">{fmtInt(s.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
