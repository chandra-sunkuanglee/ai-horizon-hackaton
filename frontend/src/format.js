export const fmtInt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

export const fmtMoney = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

export const fmtMoneyShort = (n) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${n}`;
};

// Categorical slots, fixed order (validated palette: first three are safe all-pairs).
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
