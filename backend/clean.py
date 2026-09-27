"""Clean the raw Allegheny County property sales CSVs into one analysis-ready file.

Usage:  python backend/clean.py
Reads:  ./20*.csv (raw county exports)
Writes: data/sales_clean.parquet, data/quality_report.json
"""
from __future__ import annotations

import glob
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data"

# Sales below this are almost always nominal transfers ($1 deeds, gifts), not market prices.
MIN_PRICE = 10_000

# County sale codes that the assessor treats as a valid, arm's-length market sale.
ARMS_LENGTH_CODES = {"0"}

# Codes that describe non-market transfers even when a real-looking price is recorded.
NON_MARKET_CODES = {
    "3": "Love and affection (family) sale",
    "1": "Sheriff sale",
    "2": "City treasurer sale",
    "GV": "Government sale",
    "35": "Corporation transfer",
    "36": "Quit claim",
    "13": "Exempt buyer or seller",
    "32": "Court ordered sale",
    "33": "Sale of previous foreclosure",
    "34": "Short sale",
    "BK": "Bank / financial institution",
    "99": "Corrective deed / duplicate",
}


def normalize_muni(name: str) -> str:
    name = re.sub(r"\s+", " ", str(name)).strip()
    return name


def muni_group(name: str) -> str:
    """Roll city wards up to their city ("10th Ward - PITTSBURGH" -> "Pittsburgh")."""
    m = re.search(r"Ward\s*-\s*(.+)$", name)
    if m:
        return m.group(1).strip().title()
    return name


def main() -> None:
    files = sorted(glob.glob(str(ROOT / "20*.csv")))
    raw = pd.concat([pd.read_csv(f, dtype=str) for f in files], ignore_index=True)
    report: dict = {"source_files": [Path(f).name for f in files], "raw_rows": len(raw)}
    steps: list[dict] = []

    def step(label: str, before: int, after: int, note: str) -> None:
        steps.append({"step": label, "removed": before - after, "remaining": after, "note": note})

    df = raw.copy()
    df["PRICE"] = pd.to_numeric(df["PRICE"], errors="coerce")
    df["SALEDATE"] = pd.to_datetime(df["SALEDATE"], errors="coerce")

    n = len(df)
    df = df.dropna(subset=["PRICE", "SALEDATE"])
    step("Missing price or sale date", n, len(df), "Rows without a usable price or date.")

    n = len(df)
    df = df[df["PRICE"] >= MIN_PRICE]
    step(
        f"Price below ${MIN_PRICE:,}",
        n,
        len(df),
        "Nominal transfers ($0/$1 deeds, gifts); not a market price.",
    )

    n = len(df)
    df = df.drop_duplicates(subset=["PARID", "SALEDATE", "PRICE"])
    step("Duplicate parcel + date + price", n, len(df), "Same transaction recorded more than once.")

    df["SALECODE"] = df["SALECODE"].fillna("").str.strip()
    df["municipality"] = df["MUNIDESC"].map(normalize_muni)
    df["muni_group"] = df["municipality"].map(muni_group)
    df["is_arms_length"] = df["SALECODE"].isin(ARMS_LENGTH_CODES)
    df["is_multi_parcel"] = df["SALECODE"].eq("H")
    df["is_non_market"] = df["SALECODE"].isin(NON_MARKET_CODES.keys())

    clean = pd.DataFrame(
        {
            "id": df["_id"].astype("int64"),
            "parcel_id": df["PARID"],
            "address": df["FULL_ADDRESS"].str.strip(),
            "zip": df["PROPERTYZIP"].str[:5],
            "municode": df["MUNICODE"].str.strip(),
            "municipality": df["municipality"],
            "muni_group": df["muni_group"],
            "school_district": df["SCHOOLDESC"].str.strip(),
            "sale_date": df["SALEDATE"],
            "year": df["SALEDATE"].dt.year.astype("int16"),
            "month": df["SALEDATE"].dt.to_period("M").astype(str),
            "quarter": df["SALEDATE"].dt.to_period("Q").astype(str),
            "price": df["PRICE"].astype("float64"),
            "sale_code": df["SALECODE"],
            "sale_desc": df["SALEDESC"].fillna("").str.strip().str.title(),
            "instrument": df["INSTRTYPDESC"].fillna("").str.strip().str.title(),
            "is_arms_length": df["is_arms_length"],
            "is_multi_parcel": df["is_multi_parcel"],
            "is_non_market": df["is_non_market"],
        }
    ).sort_values("sale_date")

    OUT_DIR.mkdir(exist_ok=True)
    clean.to_parquet(OUT_DIR / "sales_clean.parquet", index=False)

    last = clean["sale_date"].max()
    by_year = clean.groupby("year")
    arms_by_year = {
        int(y): {
            "priced_sales": int(len(g)),
            "arms_length_sales": int(g["is_arms_length"].sum()),
            "arms_length_share": round(float(g["is_arms_length"].mean()), 3),
            "median_all_priced": round(float(g["price"].median())),
            "median_arms_length": round(float(g.loc[g["is_arms_length"], "price"].median())),
        }
        for y, g in by_year
    }
    shares = {y: v["arms_length_share"] for y, v in arms_by_year.items()}
    lo_year, hi_year = min(shares, key=shares.get), max(shares, key=shares.get)
    report.update(
        {
            "clean_rows": len(clean),
            "cleaning_steps": steps,
            "min_price_threshold": MIN_PRICE,
            "date_range": [str(clean["sale_date"].min().date()), str(last.date())],
            "partial_year_note": (
                f"{last.year} data runs only through {last.date()}; "
                "full-year comparisons against it are not like-for-like."
            ),
            "municipalities": int(clean["municipality"].nunique()),
            "municipality_groups": int(clean["muni_group"].nunique()),
            "school_districts": int(clean["school_district"].nunique()),
            "arms_length_rows": int(clean["is_arms_length"].sum()),
            "multi_parcel_rows": int(clean["is_multi_parcel"].sum()),
            "non_market_rows": int(clean["is_non_market"].sum()),
            "rows_by_year": {int(k): int(v) for k, v in clean["year"].value_counts().sort_index().items()},
            "arms_length_by_year": arms_by_year,
            "sale_code_breakdown": [
                {"code": c, "description": d, "rows": int(r)}
                for (c, d), r in clean.groupby(["sale_code", "sale_desc"]).size().sort_values(ascending=False).items()
            ],
            "caveats": [
                f"The share of priced sales the assessor validated as arm's-length varies by year, from "
                f"{shares[lo_year]:.0%} in {lo_year} to {shares[hi_year]:.0%} in {hi_year}. Long-run trends on "
                "arm's-length sales therefore rest on very different sample sizes; check them against all priced sales.",
                "Only about half of priced sales carry the assessor's 'valid sale' code (0). "
                "Use the arm's-length filter for market-price questions.",
                "Multi-parcel sales (code H) record one price for several parcels, so per-parcel prices are inflated.",
                "Sale prices cover every property type (houses, condos, commercial, land); the county "
                "sales file has no property-type field.",
                "Small municipalities have few sales per year, so their medians are noisy.",
            ],
        }
    )
    (OUT_DIR / "quality_report.json").write_text(json.dumps(report, indent=2))

    print(f"raw rows: {len(raw):,}  ->  clean rows: {len(clean):,}")
    for s in steps:
        print(f"  - {s['step']}: removed {s['removed']:,} (remaining {s['remaining']:,})")
    print(f"arm's-length rows: {report['arms_length_rows']:,}; municipalities: {report['municipalities']}")


if __name__ == "__main__":
    main()
