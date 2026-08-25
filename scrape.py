#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
from pathlib import Path

from collector.cafes import collect_recent_posts
from collector.price import collect_price_history, collect_recent_prices
from collector.snapshot import build_snapshot, load_snapshot, write_snapshot
from collector.time_utils import KST, monday_of

DATA_PATH = Path("public/data.json")


def main() -> None:
    now = dt.datetime.now(tz=KST)
    baseline = load_snapshot(DATA_PATH)

    # OHLCV is backfilled exactly when the baseline lacks it. Existing historical
    # close/mean values remain immutable; subsequent runs request only 28 days.
    method = (
        baseline["raw"].get("collection", {})
        .get("price", {})
        .get("ohlcvMethod")
    )
    missing_ohlcv = (
        any(point.get("btcVolume") is None for point in baseline["series"])
        or method != "coinbase_daily_kst_week_v4"
    )
    if missing_ohlcv:
        first_week = dt.date.fromisoformat(baseline["series"][0]["week"])
        prices = collect_price_history(now, first_week)
    else:
        prices = collect_recent_prices(now)

    # Query only the current and previous KST week. If any source is unavailable,
    # preserve the prior aggregate and expose the degraded state in the snapshot.
    post_cutoff_day = monday_of(now.date()) - dt.timedelta(days=7)
    post_cutoff = dt.datetime.combine(post_cutoff_day, dt.time.min, tzinfo=KST)
    cafes = collect_recent_posts(now, post_cutoff)

    snapshot = build_snapshot(baseline, prices, cafes, now)
    write_snapshot(DATA_PATH, snapshot)
    print(
        "snapshot updated: "
        f"BTC through {prices.observed_through}; "
        f"posts={cafes.status}; price={prices.mode}"
    )
    if cafes.failures:
        print("warning: post counts preserved due to: " + ", ".join(cafes.failures))


if __name__ == "__main__":
    main()
