"""Claude Q&A over the sales data: a tool-use loop that streams progress events."""
from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator

import anthropic

import analytics as A

MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5")
EFFORT = os.getenv("CLAUDE_EFFORT", "medium")
MAX_TOOL_ROUNDS = 8

log = logging.getLogger(__name__)

client = anthropic.Anthropic()

FILTER_PROPS = {
    "municipality": {"type": "string", "description": "Municipality or city name (partial match). 'Pittsburgh' matches all Pittsburgh wards."},
    "school_district": {"type": "string", "description": "School district name (partial match)."},
    "zip_code": {"type": "string", "description": "5-digit ZIP code."},
    "year_from": {"type": "integer", "description": "First sale year to include."},
    "year_to": {"type": "integer", "description": "Last sale year to include."},
    "arms_length_only": {"type": "boolean", "description": "Only assessor-validated market sales (code 0). Default true; set false to include every priced transfer."},
    "exclude_multi_parcel": {"type": "boolean", "description": "Drop multi-parcel sales whose price covers several parcels. Default true."},
    "min_price": {"type": "number"},
    "max_price": {"type": "number"},
}

TOOLS = [
    {
        "name": "sales_stats",
        "description": (
            "Sale count and median/mean/quartile prices for a filtered set of sales, optionally grouped. "
            "Each row has low_sample=true when it rests on fewer than 30 sales."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **FILTER_PROPS,
                "group_by": {"type": "string", "enum": list(A.GROUP_FIELDS)},
                "sort": {"type": "string", "enum": ["key", "median_desc", "median_asc", "sales_desc"]},
                "limit": {"type": "integer", "description": "Max groups returned (default 50)."},
            },
        },
    },
    {
        "name": "price_change",
        "description": "Percent change in median sale price between two years for a filtered set of sales.",
        "input_schema": {
            "type": "object",
            "properties": {
                **FILTER_PROPS,
                "from_year": {"type": "integer"},
                "to_year": {"type": "integer"},
            },
            "required": ["from_year", "to_year"],
        },
    },
    {
        "name": "top_sales",
        "description": "Individual highest (or lowest) priced sales matching a filter.",
        "input_schema": {
            "type": "object",
            "properties": {**FILTER_PROPS, "n": {"type": "integer"}, "lowest": {"type": "boolean"}},
        },
    },
    {
        "name": "find_names",
        "description": "Look up exact municipality, city (muni_group), school district, or ZIP names and their sale counts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["municipality", "muni_group", "school_district", "zip"]},
                "search": {"type": "string"},
            },
            "required": ["kind"],
        },
    },
    {
        "name": "data_quality_report",
        "description": "How the dataset was cleaned, rows removed at each step, sale-code breakdown, date coverage and known caveats.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def _system_prompt() -> str:
    q = A.quality_report()
    return f"""You are a housing-market analyst answering questions about property sales in Allegheny County, Pennsylvania, for a public dashboard.

Dataset: {q['clean_rows']:,} cleaned sales records ({q['arms_length_rows']:,} assessor-validated arm's-length sales), {q['municipalities']} municipalities (wards counted separately; {q['municipality_groups']} after rolling wards up to cities), sale dates {q['date_range'][0]} to {q['date_range'][1]}. {q['partial_year_note']}

Answer only from tool results; never invent numbers. Call the tools as many times as you need, and in parallel when the lookups are independent. Default to arm's-length sales excluding multi-parcel sales, and say so when it matters. If a name is ambiguous or matches nothing, look it up with find_names.

Be transparent about data quality in every answer that cites numbers:
- State the filter and sample size behind each figure.
- Flag any figure with low_sample=true as unreliable.
- Note when a comparison involves the partial current year.
- The assessor validated far fewer sales as arm's-length in some years (see arms_length_by_year in the data quality report). For trends spanning those years, check the result with arms_length_only=false and mention if the two disagree.
- Prices cover every property type (houses, condos, commercial, land), so a median is not a "home price".

Write a short, direct answer in Markdown: the headline finding first, then supporting figures (a small table when comparing several places or years), then a one-line "Data notes" section. Keep it under about 250 words unless the user asks for more."""


def _run_tool(name: str, args: dict) -> object:
    filters = {k: args[k] for k in FILTER_PROPS if k in args}
    if name == "sales_stats":
        df = A.filter_sales(**filters)
        return A.summarize(df, args.get("group_by"), limit=int(args.get("limit", 50)), sort=args.get("sort", "key"))
    if name == "price_change":
        return A.price_change(A.filter_sales(**filters), int(args["from_year"]), int(args["to_year"]))
    if name == "top_sales":
        return A.top_sales(A.filter_sales(**filters), n=min(int(args.get("n", 10)), 50), ascending=bool(args.get("lowest")))
    if name == "find_names":
        return A.list_names(args["kind"], args.get("search"))[:60]
    if name == "data_quality_report":
        return A.quality_report()
    raise ValueError(f"Unknown tool {name}")


def ask(question: str, history: list[dict] | None = None) -> Iterator[dict]:
    """Yield events: {"type": "tool", ...}, {"type": "text", "delta": ..., "round": n}, {"type": "done"} or {"type": "error"}."""
    messages: list = [*(history or []), {"role": "user", "content": question}]
    try:
        for round_no in range(MAX_TOOL_ROUNDS):
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=16000,
                system=_system_prompt(),
                tools=TOOLS,
                messages=messages,
                thinking={"type": "adaptive"},
                output_config={"effort": EFFORT},
                cache_control={"type": "ephemeral"},
                betas=["server-side-fallback-2026-07-01"],
                extra_body={"fallbacks": "default"},
            ) as stream:
                for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield {"type": "text", "delta": event.delta.text, "round": round_no}
                response = stream.get_final_message()

            if response.stop_reason == "refusal":
                yield {"type": "error", "message": "Claude declined to answer this question."}
                return
            if response.stop_reason != "tool_use":
                yield {"type": "done"}
                return

            messages.append({"role": "assistant", "content": response.content})
            results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                try:
                    out = _run_tool(block.name, dict(block.input))
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out, default=str)})
                    yield {"type": "tool", "name": block.name, "input": block.input}
                except Exception as exc:  # report tool errors back to Claude instead of failing the request
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": f"Error: {exc}", "is_error": True})
                    yield {"type": "tool", "name": block.name, "input": block.input, "error": str(exc)}
            messages.append({"role": "user", "content": results})
        yield {"type": "error", "message": "Stopped after too many tool rounds."}
    except anthropic.AuthenticationError:
        yield {"type": "error", "message": "Anthropic API credentials are missing or invalid. Set ANTHROPIC_API_KEY in backend/.env."}
    except anthropic.RateLimitError:
        yield {"type": "error", "message": "Rate limited by the Anthropic API. Try again in a minute."}
    except anthropic.APIStatusError as exc:
        yield {"type": "error", "message": f"Anthropic API error ({exc.status_code}): {exc.message}"}
    except anthropic.APIConnectionError:
        yield {"type": "error", "message": "Could not reach the Anthropic API."}
    except Exception as exc:  # e.g. no credentials configured at all (the SDK raises before sending)
        log.exception("ask() failed")
        msg = str(exc)
        if "authentication" in msg.lower():
            msg = "No Anthropic API credentials found. Set ANTHROPIC_API_KEY in backend/.env and restart the server."
        yield {"type": "error", "message": msg}
