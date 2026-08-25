from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from collector.cafes import CafeCollection
from collector.analysis import _bh_adjust
from collector.price import (
    DailyCandle,
    PriceCollection,
    PriceCollectionError,
    _aggregate_weeks,
    _as_rows,
)
from collector.snapshot import SnapshotError, build_snapshot, load_snapshot, write_snapshot
from collector.time_utils import KST


def point(week: str, posts: int, mean: float, close: float) -> dict[str, object]:
    return {
        "week": week,
        "postCount": posts,
        "btcMean": mean,
        "btcClose": close,
        "btcOpen": None,
        "btcHigh": None,
        "btcLow": None,
        "btcVolume": None,
        "btcExchangeClose": None,
        "realizedVolatility": None,
        "rangePct": None,
        "priceObservations": None,
        "nextWeekClose": None,
        "nextWeekReturn": None,
        "periodStatus": "complete",
    }


class CollectorContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = dt.datetime(2026, 8, 25, 12, tzinfo=KST)
        self.baseline = {
            "series": [
                point("2026-08-03", 7, 100.0, 101.0),
                point("2026-08-10", 5, 110.0, 111.0),
                point("2026-08-17", 3, 120.0, 121.0),
                point("2026-08-24", 1, 130.0, 131.0),
            ]
        }
        self.prices = PriceCollection(
            weeks={
                "2026-08-17": {
                    "btcMean": 220.0, "btcClose": 221.0, "btcOpen": 210.0,
                    "btcHigh": 225.0, "btcLow": 205.0, "btcVolume": 1000.0,
                    "realizedVolatility": 5.0, "rangePct": 9.75, "observations": 7.0,
                },
                "2026-08-24": {
                    "btcMean": 230.0, "btcClose": 231.0, "btcOpen": 222.0,
                    "btcHigh": 235.0, "btcLow": 220.0, "btcVolume": 300.0,
                    "realizedVolatility": 2.0, "rangePct": 6.82, "observations": 2.0,
                },
            },
            observed_through="2026-08-25",
            request_days=29,
            refresh_from="2026-08-17",
        )

    def test_rate_limit_is_a_hard_error_not_partial_success(self) -> None:
        with self.assertRaisesRegex(PriceCollectionError, "rate limit"):
            _as_rows({"message": "over your rate limit"})

    def test_incremental_merge_never_rewrites_older_price_history(self) -> None:
        cafes = CafeCollection({"2026-08-17": 8, "2026-08-24": 2}, "ok", (), 21)
        result = build_snapshot(self.baseline, self.prices, cafes, self.now)
        rows = {row["week"]: row for row in result["series"]}

        self.assertEqual(rows["2026-08-03"]["btcClose"], 101.0)
        self.assertEqual(rows["2026-08-10"]["btcClose"], 111.0)
        self.assertEqual(rows["2026-08-17"]["btcClose"], 221.0)
        self.assertEqual(rows["2026-08-24"]["btcClose"], 231.0)
        self.assertEqual(rows["2026-08-17"]["postCount"], 8)
        self.assertEqual(rows["2026-08-17"]["btcVolume"], 1000.0)
        self.assertEqual(rows["2026-08-24"]["periodStatus"], "in_progress")

    def test_history_enrichment_does_not_rewrite_valid_old_close(self) -> None:
        prices = PriceCollection(
            weeks={
                "2026-08-03": {
                    "btcMean": 999.0, "btcClose": 999.0, "btcOpen": 90.0,
                    "btcHigh": 110.0, "btcLow": 80.0, "btcVolume": 42.0,
                    "realizedVolatility": 4.0, "rangePct": 37.5, "observations": 7.0,
                },
                **self.prices.weeks,
            },
            observed_through=self.prices.observed_through,
            request_days=3800,
            refresh_from=self.prices.refresh_from,
            mode="history_enrichment:16_requests",
        )
        result = build_snapshot(
            self.baseline,
            prices,
            CafeCollection(None, "degraded", ("test",), 21),
            self.now,
        )
        old = result["series"][0]
        self.assertEqual(old["btcClose"], 101.0)
        self.assertEqual(old["btcMean"], 100.0)
        self.assertEqual(old["btcVolume"], 42.0)
        self.assertEqual(old["btcExchangeClose"], 999.0)
        self.assertEqual(result["schemaVersion"], 4)

    def test_weekly_ohlcv_and_realized_volatility_are_aggregated(self) -> None:
        candles = [
            DailyCandle(dt.datetime(2026, 8, 16, 9, tzinfo=KST), 90, 101, 95, 100, 5),
            DailyCandle(dt.datetime(2026, 8, 17, 9, tzinfo=KST), 95, 105, 100, 102, 10),
            DailyCandle(dt.datetime(2026, 8, 18, 9, tzinfo=KST), 100, 112, 102, 110, 20),
        ]
        week = _aggregate_weeks(candles)["2026-08-17"]
        self.assertEqual(week["btcOpen"], 100)
        self.assertEqual(week["btcHigh"], 112)
        self.assertEqual(week["btcLow"], 95)
        self.assertEqual(week["btcClose"], 110)
        self.assertEqual(week["btcVolume"], 30)
        expected = (
            __import__("math").log(102 / 100) ** 2
            + __import__("math").log(110 / 102) ** 2
        ) ** 0.5 * 100
        self.assertAlmostEqual(week["realizedVolatility"], expected)

    def test_benjamini_hochberg_adjustment_is_monotone_by_rank(self) -> None:
        adjusted = _bh_adjust([0.01, 0.04, 0.03, 0.8])
        self.assertEqual(len(adjusted), 4)
        self.assertAlmostEqual(adjusted[0], 0.04)
        self.assertLessEqual(adjusted[2], adjusted[1])
        self.assertEqual(adjusted[3], 0.8)

    def test_degraded_cafe_fetch_preserves_known_counts_while_btc_advances(self) -> None:
        cafes = CafeCollection(None, "degraded", ("naver:1:HTTPError",), 21)
        result = build_snapshot(self.baseline, self.prices, cafes, self.now)
        rows = {row["week"]: row for row in result["series"]}

        self.assertEqual(rows["2026-08-17"]["postCount"], 3)
        self.assertEqual(rows["2026-08-24"]["postCount"], 1)
        self.assertEqual(rows["2026-08-24"]["btcClose"], 231.0)
        self.assertEqual(result["collection"]["posts"]["status"], "degraded")

    def test_incremental_partial_leading_week_cannot_replace_ohlcv(self) -> None:
        baseline = {
            "series": [
                {
                    **point("2026-08-03", 7, 100.0, 101.0),
                    "btcVolume": 700.0,
                    "priceObservations": 7,
                },
                *self.baseline["series"][1:],
            ]
        }
        partial = PriceCollection(
            weeks={
                "2026-08-03": {
                    "btcMean": 999.0, "btcClose": 999.0, "btcOpen": 90.0,
                    "btcHigh": 110.0, "btcLow": 80.0, "btcVolume": 500.0,
                    "realizedVolatility": 4.0, "rangePct": 37.5, "observations": 5.0,
                },
                **self.prices.weeks,
            },
            observed_through=self.prices.observed_through,
            request_days=29,
            refresh_from=self.prices.refresh_from,
        )
        result = build_snapshot(
            baseline,
            partial,
            CafeCollection(None, "degraded", ("test",), 21),
            self.now,
        )
        old = result["series"][0]
        self.assertEqual(old["btcClose"], 101.0)
        self.assertEqual(old["btcVolume"], 700.0)
        self.assertEqual(old["priceObservations"], 7)

    def test_v2_loader_rejects_misaligned_arrays(self) -> None:
        broken = {
            "schemaVersion": 2,
            "weeks": ["2026-08-24"],
            "postCounts": [],
            "btcWeeklyMean": [1],
            "btcWeeklyClose": [1],
            "btcNextWeekClose": [None],
            "btcNextWeekReturn": [None],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaises(SnapshotError):
                load_snapshot(path)

    def test_snapshot_write_is_valid_json_and_replaces_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            path.write_text("old", encoding="utf-8")
            write_snapshot(path, {"schemaVersion": 4, "series": []})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["schemaVersion"], 4)


if __name__ == "__main__":
    unittest.main()
