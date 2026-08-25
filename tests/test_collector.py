from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from collector.cafes import CafeCollection
from collector.price import PriceCollection, PriceCollectionError, _as_rows
from collector.snapshot import SnapshotError, build_snapshot, load_snapshot, write_snapshot
from collector.time_utils import KST


def point(week: str, posts: int, mean: float, close: float) -> dict[str, object]:
    return {
        "week": week,
        "postCount": posts,
        "btcMean": mean,
        "btcClose": close,
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
                "2026-08-17": {"btcMean": 220.0, "btcClose": 221.0},
                "2026-08-24": {"btcMean": 230.0, "btcClose": 231.0},
            },
            observed_through="2026-08-25",
            request_days=29,
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
        self.assertEqual(rows["2026-08-24"]["periodStatus"], "in_progress")

    def test_degraded_cafe_fetch_preserves_known_counts_while_btc_advances(self) -> None:
        cafes = CafeCollection(None, "degraded", ("naver:1:HTTPError",), 21)
        result = build_snapshot(self.baseline, self.prices, cafes, self.now)
        rows = {row["week"]: row for row in result["series"]}

        self.assertEqual(rows["2026-08-17"]["postCount"], 3)
        self.assertEqual(rows["2026-08-24"]["postCount"], 1)
        self.assertEqual(rows["2026-08-24"]["btcClose"], 231.0)
        self.assertEqual(result["collection"]["posts"]["status"], "degraded")

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
            write_snapshot(path, {"schemaVersion": 3, "series": []})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["schemaVersion"], 3)


if __name__ == "__main__":
    unittest.main()
