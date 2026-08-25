from __future__ import annotations

import datetime as dt
import math
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import requests

from .time_utils import KST, UTC, iso_week, monday_of, week_range

COINBASE_URL = "https://api.exchange.coinbase.com/products/BTC-USD/candles"
DAY_SECONDS = 86400
CHUNK_DAYS = 250


class PriceCollectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class DailyCandle:
    timestamp: dt.datetime
    low: float
    high: float
    open: float
    close: float
    volume: float


@dataclass(frozen=True)
class PriceCollection:
    weeks: dict[str, dict[str, float]]
    observed_through: str
    request_days: int
    refresh_from: str
    mode: str = "incremental"


def _as_rows(payload: Any) -> list[list[Any]]:
    if isinstance(payload, dict):
        raise PriceCollectionError(str(payload.get("message") or "Coinbase returned an error"))
    if not isinstance(payload, list) or not payload:
        raise PriceCollectionError("Coinbase returned no daily prices")
    return payload


def _request_rows(
    client: requests.Session,
    start: dt.datetime,
    end: dt.datetime,
) -> list[list[Any]]:
    try:
        response = client.get(
            COINBASE_URL,
            params={
                "granularity": DAY_SECONDS,
                "start": start.isoformat().replace("+00:00", "Z"),
                "end": end.isoformat().replace("+00:00", "Z"),
            },
            headers={"User-Agent": "momcafe-bitcoin-web/4.0"},
            timeout=30,
        )
        response.raise_for_status()
        return _as_rows(response.json())
    except PriceCollectionError:
        raise
    except (requests.RequestException, ValueError) as exc:
        raise PriceCollectionError(f"BTC request failed: {exc}") from exc


def _parse_candles(rows: list[list[Any]]) -> list[DailyCandle]:
    candles: dict[int, DailyCandle] = {}
    for row in rows:
        try:
            epoch = int(row[0])
            candle = DailyCandle(
                timestamp=dt.datetime.fromtimestamp(epoch, tz=UTC).astimezone(KST),
                low=float(row[1]),
                high=float(row[2]),
                open=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]),
            )
        except (IndexError, TypeError, ValueError, OSError):
            continue
        if (
            min(candle.low, candle.high, candle.open, candle.close) > 0
            and candle.high >= candle.low
            and candle.volume >= 0
        ):
            candles[epoch] = candle
    if not candles:
        raise PriceCollectionError("Coinbase response had no valid OHLCV candles")
    return sorted(candles.values(), key=lambda candle: candle.timestamp)


def _aggregate_weeks(candles: list[DailyCandle]) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[DailyCandle]] = defaultdict(list)
    for candle in candles:
        grouped[iso_week(candle.timestamp)].append(candle)
    squared_returns: dict[str, list[float]] = defaultdict(list)
    ordered_all = sorted(candles, key=lambda candle: candle.timestamp)
    for previous, current in zip(ordered_all, ordered_all[1:]):
        if current.timestamp - previous.timestamp <= dt.timedelta(days=2):
            squared_returns[iso_week(current.timestamp)].append(
                math.log(current.close / previous.close) ** 2
            )

    weeks: dict[str, dict[str, float]] = {}
    for week, values in grouped.items():
        ordered = sorted(values, key=lambda candle: candle.timestamp)
        closes = [candle.close for candle in ordered]
        week_open = ordered[0].open
        week_high = max(candle.high for candle in ordered)
        week_low = min(candle.low for candle in ordered)
        weeks[week] = {
            "btcMean": sum(closes) / len(closes),
            "btcClose": closes[-1],
            "btcOpen": week_open,
            "btcHigh": week_high,
            "btcLow": week_low,
            "btcVolume": sum(candle.volume for candle in ordered),
            "realizedVolatility": math.sqrt(sum(squared_returns[week])) * 100,
            "rangePct": (week_high / week_low - 1) * 100,
            "observations": float(len(ordered)),
        }
    return weeks


def _validate_freshness(candles: list[DailyCandle], now: dt.datetime) -> str:
    latest_day = max(candle.timestamp.date() for candle in candles)
    if latest_day < now.astimezone(KST).date() - dt.timedelta(days=1):
        raise PriceCollectionError(f"BTC response is stale: latest={latest_day.isoformat()}")
    return latest_day.isoformat()


def collect_recent_prices(
    now: dt.datetime,
    lookback_days: int = 28,
    session: requests.Session | None = None,
) -> PriceCollection:
    client = session or requests.Session()
    end = now.astimezone(UTC)
    start = end - dt.timedelta(days=lookback_days)
    candles = _parse_candles(_request_rows(client, start, end))
    observed_through = _validate_freshness(candles, now)
    weeks = _aggregate_weeks(candles)

    refresh_day = monday_of(now.astimezone(KST).date()) - dt.timedelta(days=7)
    expected = set(week_range(refresh_day, now.astimezone(KST).date()))
    if not expected.issubset(weeks):
        missing = ", ".join(sorted(expected - set(weeks)))
        raise PriceCollectionError(f"BTC response has missing weekly coverage: {missing}")

    return PriceCollection(
        weeks=weeks,
        observed_through=observed_through,
        request_days=lookback_days + 1,
        refresh_from=refresh_day.isoformat(),
    )


def collect_price_history(
    now: dt.datetime,
    first_week: dt.date,
    session: requests.Session | None = None,
    pause_seconds: float = 0.15,
) -> PriceCollection:
    """Backfill OHLCV once while allowing close/mean refresh only for two weeks."""
    client = session or requests.Session()
    cursor = dt.datetime.combine(
        first_week - dt.timedelta(days=1), dt.time.min, tzinfo=KST
    ).astimezone(UTC)
    end = now.astimezone(UTC)
    all_rows: list[list[Any]] = []
    request_count = 0
    while cursor < end:
        chunk_end = min(cursor + dt.timedelta(days=CHUNK_DAYS), end)
        all_rows.extend(_request_rows(client, cursor, chunk_end))
        request_count += 1
        cursor = chunk_end
        if cursor < end and pause_seconds:
            time.sleep(pause_seconds)

    candles = _parse_candles(all_rows)
    observed_through = _validate_freshness(candles, now)
    weeks = _aggregate_weeks(candles)
    weeks = {week: values for week, values in weeks.items() if week >= first_week.isoformat()}
    expected = set(week_range(first_week, now.astimezone(KST).date()))
    if not expected.issubset(weeks):
        missing = sorted(expected - set(weeks))
        preview = ", ".join(missing[:5])
        raise PriceCollectionError(
            f"BTC history has {len(missing)} missing weeks: {preview}"
        )

    refresh_day = monday_of(now.astimezone(KST).date()) - dt.timedelta(days=7)
    return PriceCollection(
        weeks=weeks,
        observed_through=observed_through,
        request_days=(end.date() - first_week).days + 1,
        refresh_from=refresh_day.isoformat(),
        mode=f"history_enrichment:{request_count}_requests",
    )
