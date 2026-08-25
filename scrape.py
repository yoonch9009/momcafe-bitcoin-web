#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
from pathlib import Path

from collector.cafes import collect_recent_posts
from collector.price import collect_recent_prices
from collector.snapshot import build_snapshot, load_snapshot, write_snapshot
from collector.time_utils import KST, monday_of

DATA_PATH = Path("public/data.json")


def main() -> None:
    now = dt.datetime.now(tz=KST)
    baseline = load_snapshot(DATA_PATH)

    # Mandatory: a failed or stale price response must never replace the last
    # known-good snapshot.
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
        f"posts={cafes.status}; mode=incremental"
    )
    if cafes.failures:
        print("warning: post counts preserved due to: " + ", ".join(cafes.failures))


if __name__ == "__main__":
    main()
