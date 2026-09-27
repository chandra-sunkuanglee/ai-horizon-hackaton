"""In-memory query layer over the cleaned sales data.

Used both by the dashboard's REST endpoints and by the tools Claude calls.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

GROUP_FIELDS = {
    "year": "year",
    "quarter": "quarter",
    "month": "month",
    "municipality": "municipality",
    "muni_group": "muni_group",
    "school_district": "school_district",
    "zip": "zip",
    "sale_type": "sale_desc",
}

# Below this many sales a median is flagged as unreliable.
MIN_RELIABLE_N = 30


@lru_cache(maxsize=1)
def sales() -> pd.DataFrame:
    path = DATA_DIR / "sales_clean.parquet"
    if not path.exists():
        raise RuntimeError("data/sales_clean.parquet missing - run `python backend/clean.py` first.")
    df = pd.read_parquet(path)
    # Punctuation/space-free lowercase keys so "Mt. Lebanon" matches "Mt.Lebanon".
    for col in ("municipality", "muni_group", "school_district"):
        df[f"_{col}_key"] = df[col].map(_key)
    return df


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


@lru_cache(maxsize=1)
def quality_report() -> dict:
    return json.loads((DATA_DIR / "quality_report.json").read_text())


def _match(df: pd.DataFrame, col: str, needle: str) -> pd.Series:
    """Exact (normalized) match when the name exists, else substring match.

    Without the exact-first rule "Pittsburgh" would also match "East Pittsburgh".
    """
    keys = df[f"_{col}_key"]
    k = _key(needle)
    exact = keys.eq(k)
    return exact if exact.any() else keys.str.contains(k, regex=False, na=False)


def _match_place(df: pd.DataFrame, needle: str) -> pd.Series:
    k = _key(needle)
    for col in ("muni_group", "municipality"):
        exact = df[f"_{col}_key"].eq(k)
        if exact.any():
            return exact
    return _match(df, "municipality", needle) | _match(df, "muni_group", needle)


def filter_sales(
    municipality: str | None = None,
    municode: str | None = None,
    school_district: str | None = None,
    zip_code: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    arms_length_only: bool = True,
    exclude_multi_parcel: bool = True,
    min_price: float | None = None,
    max_price: float | None = None,
) -> pd.DataFrame:
    df = sales()
    mask = pd.Series(True, index=df.index)
    if municipality:
        # Match either the ward-level name or the rolled-up city name.
        mask &= _match_place(df, municipality)
    if municode:
        mask &= df["municode"].eq(str(municode))
    if school_district:
        mask &= _match(df, "school_district", school_district)
    if zip_code:
        mask &= df["zip"].eq(str(zip_code).strip()[:5])
    if year_from:
        mask &= df["year"] >= int(year_from)
    if year_to:
        mask &= df["year"] <= int(year_to)
    if arms_length_only:
        mask &= df["is_arms_length"]
    if exclude_multi_parcel:
        mask &= ~df["is_multi_parcel"]
    if min_price is not None:
        mask &= df["price"] >= float(min_price)
    if max_price is not None:
        mask &= df["price"] <= float(max_price)
    return df[mask]


def summarize(df: pd.DataFrame, group_by: str | None = None, limit: int = 50, sort: str = "key") -> list[dict]:
    """Count / median / mean / quartiles, optionally grouped."""

    def stats(g: pd.DataFrame) -> dict:
        p = g["price"]
        return {
            "sales": int(len(p)),
            "median_price": round(float(p.median()), 0) if len(p) else None,
            "mean_price": round(float(p.mean()), 0) if len(p) else None,
            "p25_price": round(float(p.quantile(0.25)), 0) if len(p) else None,
            "p75_price": round(float(p.quantile(0.75)), 0) if len(p) else None,
            "low_sample": bool(len(p) < MIN_RELIABLE_N),
        }

    if not group_by:
        return [{"group": "all", **stats(df)}]
    col = GROUP_FIELDS[group_by]
    rows = [{"group": str(k), **stats(g)} for k, g in df.groupby(col, observed=True)]
    if sort == "median_desc":
        rows.sort(key=lambda r: -(r["median_price"] or 0))
    elif sort == "median_asc":
        rows.sort(key=lambda r: r["median_price"] or 0)
    elif sort == "sales_desc":
        rows.sort(key=lambda r: -r["sales"])
    else:
        rows.sort(key=lambda r: r["group"])
    return rows[:limit]


def price_change(df: pd.DataFrame, from_year: int, to_year: int) -> dict:
    a = df[df["year"] == from_year]["price"]
    b = df[df["year"] == to_year]["price"]
    if a.empty or b.empty:
        return {"error": f"No sales in {from_year if a.empty else to_year} for this filter."}
    ma, mb = float(a.median()), float(b.median())
    return {
        "from_year": from_year,
        "to_year": to_year,
        "median_from": round(ma),
        "median_to": round(mb),
        "pct_change": round((mb - ma) / ma * 100, 1),
        "sales_from": int(len(a)),
        "sales_to": int(len(b)),
        "low_sample": bool(min(len(a), len(b)) < MIN_RELIABLE_N),
    }


def change_windows(year_from: int, year_to: int) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """Early and late windows for a price-change figure over [year_from, year_to].

    Ranges of 4+ years compare the first two years with the last two (pooled, so small
    places have enough sales); shorter ranges compare single years.
    """
    if year_to <= year_from:
        return None
    if year_to - year_from >= 3:
        return (year_from, year_from + 1), (year_to - 1, year_to)
    return (year_from, year_from), (year_to, year_to)


def window_label(w: tuple[int, int]) -> str:
    return str(w[0]) if w[0] == w[1] else f"{w[0]}–{str(w[1])[2:]}"


def _median_n(g: pd.DataFrame, years: tuple[int, int]) -> tuple[float | None, int]:
    p = g.loc[g["year"].between(*years), "price"]
    return (round(float(p.median())) if len(p) else None), int(len(p))


def _place_stats(g: pd.DataFrame, windows) -> dict:
    n = int(len(g))
    median = round(float(g["price"].median())) if n else None
    out = {"median": median if n >= MIN_RELIABLE_N else None, "median_n": n, "change": None, "change_n": [0, 0]}
    if windows:
        (m0, n0), (m1, n1) = _median_n(g, windows[0]), _median_n(g, windows[1])
        out["change_n"] = [n0, n1]
        if m0 and m1 and min(n0, n1) >= MIN_RELIABLE_N:
            out["change"] = round((m1 - m0) / m0 * 100, 1)
    return out


def resolve_years(year_from: int | None, year_to: int | None) -> tuple[int, int]:
    """Clamp a requested range to the data; defaults to first year .. last full year."""
    first, last_full = year_span()
    last = last_full + 1
    a = max(first, min(int(year_from or first), last))
    b = max(a, min(int(year_to or last_full), last))
    return a, b


@lru_cache(maxsize=64)
def municipality_table(arms_length_only: bool = True, year_from: int | None = None, year_to: int | None = None) -> list[dict]:
    """Per-place stats over a year range, for the dashboard table."""
    a, b = resolve_years(year_from, year_to)
    df = filter_sales(arms_length_only=arms_length_only, year_from=a, year_to=b)
    windows = change_windows(a, b)
    span = f"{window_label(windows[0])} → {window_label(windows[1])}" if windows else ""
    out = []
    for name, g in df.groupby("muni_group"):
        st = _place_stats(g, windows)
        out.append(
            {
                "municipality": name,
                "sales": st["median_n"],
                "median_price": round(float(g["price"].median())),
                "change_pct": st["change"],
                "change_span": span,
                "low_sample": st["median_n"] < MIN_RELIABLE_N,
            }
        )
    out.sort(key=lambda r: -r["sales"])
    return out


def year_span() -> tuple[int, int]:
    """First year in the data and the last complete year (the latest year is partial)."""
    years = sales()["year"]
    return int(years.min()), int(years.max()) - 1


def list_names(kind: str, search: str | None = None) -> list[dict]:
    col = {"municipality": "municipality", "muni_group": "muni_group", "school_district": "school_district", "zip": "zip"}[kind]
    counts = sales()[col].value_counts()
    if search:
        counts = counts[[_key(search) in _key(name) for name in counts.index]]
    return [{"name": k, "sales": int(v)} for k, v in counts.items()]


def top_sales(df: pd.DataFrame, n: int = 10, ascending: bool = False) -> list[dict]:
    rows = df.sort_values("price", ascending=ascending).head(n)
    return [
        {
            "address": r.address,
            "municipality": r.municipality,
            "sale_date": str(r.sale_date.date()),
            "price": round(r.price),
            "sale_type": r.sale_desc,
        }
        for r in rows.itertuples()
    ]


# ---- map ------------------------------------------------------------------

@lru_cache(maxsize=1)
def parcel_points() -> pd.DataFrame:
    return pd.read_parquet(DATA_DIR / "parcel_points.parquet").set_index("parcel_id")


@lru_cache(maxsize=1)
def _shapes() -> str:
    return (DATA_DIR / "municipalities.geojson").read_text()


@lru_cache(maxsize=64)
def map_layer(arms_length_only: bool = True, year_from: int | None = None, year_to: int | None = None) -> dict:
    """Municipality shapes with median price and price change over a year range as properties."""
    a, b = resolve_years(year_from, year_to)
    fc = json.loads(_shapes())
    df = filter_sales(arms_length_only=arms_length_only, year_from=a, year_to=b)
    windows = change_windows(a, b)
    groups = dict(tuple(df.groupby("municode")))
    for f in fc["features"]:
        g = groups.get(f["properties"]["municode"], df.iloc[0:0])
        f["properties"].update(_place_stats(g, windows))
    fc["meta"] = {
        "years": [a, b],
        "median_label": f"Median sale price, {a}–{b}" if a != b else f"Median sale price, {a}",
        "change_label": (
            f"Price change, {window_label(windows[0])} → {window_label(windows[1])}"
            if windows
            else "Price change needs at least two years"
        ),
        "min_n": MIN_RELIABLE_N,
    }
    return fc


def sale_points(
    municode: str,
    arms_length_only: bool = True,
    year_from: int | None = None,
    year_to: int | None = None,
    limit: int = 4000,
) -> list[dict]:
    df = filter_sales(municode=municode, arms_length_only=arms_length_only, year_from=year_from, year_to=year_to)
    df = df.join(parcel_points(), on="parcel_id", how="inner").sort_values("sale_date", ascending=False).head(limit)
    return [
        {
            "lat": r.lat,
            "lon": r.lon,
            "price": round(r.price),
            "date": str(r.sale_date.date()),
            "address": r.address,
            "sale_type": r.sale_desc,
        }
        for r in df.itertuples()
    ]
