from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import requests

from .time_utils import KST, UTC, iso_week, week_range

COINBASE_URL = "https://api.exchange.coinbase.com/products/BTC-USD/candles"


class PriceCollectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class PriceCollection:
    weeks: dict[str, dict[str, float]]
    observed_through: str
    request_days: int


def _as_rows(payload: Any) -> list[list[Any]]:
    if isinstance(payload, dict):
        raise PriceCollectionError(str(payload.get("message") or "Coinbase returned an error"))
    if not isinstance(payload, list) or not payload:
        raise PriceCollectionError("Coinbase returned no daily prices")
    return payload


def collect_recent_prices(
    now: dt.datetime,
    lookback_days: int = 28,
    session: requests.Session | None = None,
) -> PriceCollection:
    client = session or requests.Session()
    headers = {"User-Agent": "momcafe-bitcoin-web/3.0"}
    end = now.astimezone(UTC)
    start = end - dt.timedelta(days=lookback_days)

    try:
        response = client.get(
            COINBASE_URL,
            params={
                "granularity": 86400,
                "start": start.isoformat().replace("+00:00", "Z"),
                "end": end.isoformat().replace("+00:00", "Z"),
            },
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        rows = _as_rows(response.json())
    except (requests.RequestException, ValueError) as exc:
        raise PriceCollectionError(f"BTC request failed: {exc}") from exc

    daily: list[tuple[dt.datetime, float]] = []
    for row in rows:
        try:
            timestamp = dt.datetime.fromtimestamp(int(row[0]), tz=UTC).astimezone(KST)
            close = float(row[4])
        except (IndexError, TypeError, ValueError, OSError):
            continue
        if close > 0:
            daily.append((timestamp, close))
    if not daily:
        raise PriceCollectionError("Coinbase response had no valid positive closes")

    latest_day = max(timestamp.date() for timestamp, _ in daily)
    if latest_day < now.astimezone(KST).date() - dt.timedelta(days=1):
        raise PriceCollectionError(
            f"BTC response is stale: latest={latest_day.isoformat()}"
        )

    grouped: dict[str, list[tuple[dt.datetime, float]]] = defaultdict(list)
    for timestamp, close in daily:
        grouped[iso_week(timestamp)].append((timestamp, close))

    refresh_start = now.astimezone(KST).date() - dt.timedelta(days=lookback_days - 2)
    expected = set(week_range(refresh_start, now.astimezone(KST).date()))
    available = set(grouped)
    if not expected.issubset(available):
        missing = ", ".join(sorted(expected - available))
        raise PriceCollectionError(f"BTC response has missing weekly coverage: {missing}")

    weeks: dict[str, dict[str, float]] = {}
    for week, values in grouped.items():
        ordered = sorted(values, key=lambda item: item[0])
        closes = [close for _, close in ordered]
        weeks[week] = {
            "btcMean": sum(closes) / len(closes),
            "btcClose": closes[-1],
        }

    return PriceCollection(
        weeks=weeks,
        observed_through=latest_day.isoformat(),
        request_days=lookback_days + 1,
    )
