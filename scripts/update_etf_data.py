#!/usr/bin/env python3
"""Fetch Glassnode BTC ETF datasets and merge them into public static history."""

from __future__ import annotations

import datetime as dt
import json
import os
import ssl
import tempfile
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "etf-data.json"
OUTPUT_JS = ROOT / "etf-data.js"
ENV_FILE = ROOT.parents[1] / ".env"
BASE = "https://api.glassnode.com/v1/metrics"


def read_api_key() -> str:
    key = os.environ.get("GLASSNODE_API_KEY", "").strip()
    if key:
        return key
    candidates = [ENV_FILE, ROOT / ".env"]
    for path in candidates:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GLASSNODE_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("GLASSNODE_API_KEY is not configured")


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def fetch(metric: str, currency: str | None = None, attempts: int = 4) -> list[dict]:
    params = {"a": "BTC", "i": "24h", "api_key": read_api_key()}
    if currency:
        params["c"] = currency
    url = f"{BASE}/{metric}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "btc-onchain-etf-archive/1.0"})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=60, context=ssl_context()) as response:
                rows = json.load(response)
            break
        except HTTPError as error:
            if error.code != 429 or attempt == attempts:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else 15 * attempt
            print(f"Glassnode rate limit for {metric}; retrying in {delay}s", flush=True)
            time.sleep(delay)
    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f"Glassnode returned no rows for {metric}")
    return rows


def iso_date(timestamp: int) -> str:
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).date().isoformat()


def normalize_scalar(rows: list[dict], field: str) -> list[dict]:
    result = []
    for row in rows:
        value = row.get("v")
        if isinstance(value, (int, float)):
            result.append({"date": iso_date(int(row["t"])), field: value})
    return result


def normalize_snapshots(rows: list[dict]) -> list[dict]:
    result = []
    for row in rows:
        values = row.get("o")
        if not isinstance(values, dict):
            continue
        products = {
            ticker: value
            for ticker, value in values.items()
            if ticker != "total" and isinstance(value, (int, float))
        }
        result.append(
            {
                "date": iso_date(int(row["t"])),
                "products": products,
                "total": values.get("total") if isinstance(values.get("total"), (int, float)) else None,
                "complete": isinstance(values.get("total"), (int, float)),
            }
        )
    return result


def merge(existing: list[dict], latest: list[dict]) -> list[dict]:
    by_date = {row["date"]: row for row in existing if isinstance(row, dict) and row.get("date")}
    for row in latest:
        by_date[row["date"]] = row
    return [by_date[key] for key in sorted(by_date)]


def write_atomic(path: Path, text: str) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temp_path = Path(handle.name)
    temp_path.replace(path)


def main() -> None:
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    flow = normalize_scalar(fetch("institutions/us_spot_etf_flows_net", "usd"), "net_flow_usd")
    holdings = normalize_snapshots(fetch("institutions/us_spot_etf_balances_all", "native"))
    usd_balances = normalize_snapshots(fetch("institutions/us_spot_etf_balances_all", "usd"))
    previous_prices = previous.get("datasets", {}).get("btc_price", [])
    try:
        btc_price = normalize_scalar(fetch("market/price_usd_close"), "price_usd")
    except HTTPError as error:
        # Price is only a chart overlay. Preserve the last valid series rather than
        # blocking ETF data archival or Pages deployment on a secondary request.
        print(f"BTC price update skipped after HTTP {error.code}; preserving existing series", flush=True)
        btc_price = []

    payload = {
        "schema_version": 1,
        "source": "Glassnode",
        "retrieved_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "datasets": {
            "net_flow": merge(previous.get("datasets", {}).get("net_flow", []), flow),
            "btc_holdings": merge(previous.get("datasets", {}).get("btc_holdings", []), holdings),
            "usd_balances": merge(previous.get("datasets", {}).get("usd_balances", []), usd_balances),
            "btc_price": merge(previous_prices, btc_price),
        },
        "limitations": {
            "history_window": "API backfill is limited by the account plan; history accumulates through daily snapshots.",
            "usd_balance_label": "Glassnode USD Balance, not official fund Net Assets/AUM.",
            "etf_price_endpoint": "Unavailable for the current API plan (HTTP 403); US market calendar rules are used.",
        },
    }
    compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    write_atomic(OUTPUT, compact + "\n")
    write_atomic(OUTPUT_JS, "window.ETF_DATA=" + compact + ";\n")
    summary = {
        "retrieved_at": payload["retrieved_at"],
        "flow_records": len(payload["datasets"]["net_flow"]),
        "holdings_snapshots": len(payload["datasets"]["btc_holdings"]),
        "usd_balance_snapshots": len(payload["datasets"]["usd_balances"]),
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
