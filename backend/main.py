"""FastAPI server for the Allegheny County sales dashboard.

Run from the project root:  .venv/Scripts/python -m uvicorn main:app --app-dir backend --reload
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from fastapi import FastAPI, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import analytics as A  # noqa: E402
import assistant  # noqa: E402

@asynccontextmanager
async def lifespan(_app):
    A.sales()  # load the dataset once at startup instead of on the first (concurrent) requests
    yield


app = FastAPI(title="Allegheny County Housing Sales API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/overview")
def overview(arms_length_only: bool = True, year_from: int | None = None, year_to: int | None = None):
    a, b = A.resolve_years(year_from, year_to)
    df = A.filter_sales(arms_length_only=arms_length_only, year_from=a, year_to=b)
    q = A.quality_report()
    first, last_full = A.year_span()
    return {
        "total_records": q["clean_rows"],
        "raw_records": q["raw_rows"],
        "filtered_sales": int(len(df)),
        # A median pooled over years of rising prices means little; report the range's last year.
        "median_price": round(float(df.loc[df["year"] == b, "price"].median())),
        "median_year": b,
        "municipalities": q["municipalities"],
        "municipality_groups": q["municipality_groups"],
        "date_range": q["date_range"],
        "years": [a, b],
        "available_years": [first, last_full + 1],
        "change": A.price_change(df, a, b) if b > a else None,
        "partial_year": last_full + 1,
        "partial_year_note": q["partial_year_note"],
    }


@app.get("/api/trend")
def trend(
    municipality: str | None = None,
    municode: str | None = None,
    granularity: str = Query("quarter", pattern="^(year|quarter|month)$"),
    arms_length_only: bool = True,
    year_from: int | None = None,
    year_to: int | None = None,
):
    df = A.filter_sales(
        municipality=municipality,
        municode=municode,
        arms_length_only=arms_length_only,
        year_from=year_from,
        year_to=year_to,
    )
    return A.summarize(df, granularity, limit=500)


@app.get("/api/map")
def map_layer(arms_length_only: bool = True, year_from: int | None = None, year_to: int | None = None):
    return A.map_layer(arms_length_only, year_from, year_to)


@app.get("/api/sales_points")
def sales_points(municode: str, arms_length_only: bool = True, year_from: int | None = None, year_to: int | None = None):
    return A.sale_points(municode, arms_length_only, year_from, year_to)


@app.get("/api/municipalities")
def municipalities(arms_length_only: bool = True, year_from: int | None = None, year_to: int | None = None):
    return A.municipality_table(arms_length_only, year_from, year_to)


@app.get("/api/quality")
def quality():
    return A.quality_report()


class AskRequest(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/api/ask")
def ask(req: AskRequest):
    # Keep only plain-text turns from the client; tool traffic is rebuilt server-side each time.
    history = [
        {"role": m["role"], "content": str(m["content"])}
        for m in req.history[-10:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]

    def stream():
        for event in assistant.ask(req.question, history):
            yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


# Serve the built frontend (npm run build) when present, so one process hosts everything.
_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
