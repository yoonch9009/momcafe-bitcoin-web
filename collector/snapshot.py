from __future__ import annotations

import copy
import datetime as dt
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Any

from .cafes import CafeCollection
from .price import PriceCollection
from .time_utils import KST, monday_of, week_range


class SnapshotError(RuntimeError):
    pass


def _number(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _from_v2(raw: dict[str, Any]) -> list[dict[str, Any]]:
    keys = (
        "weeks",
        "postCounts",
        "btcWeeklyMean",
        "btcWeeklyClose",
        "btcNextWeekClose",
        "btcNextWeekReturn",
    )
    lengths = {len(raw.get(key, [])) for key in keys}
    if len(lengths) != 1 or not lengths or 0 in lengths:
        raise SnapshotError("schema v2 arrays are missing or misaligned")
    return [
        {
            "week": week,
            "postCount": int(raw["postCounts"][index]),
            "btcMean": _number(raw["btcWeeklyMean"][index]),
            "btcClose": _number(raw["btcWeeklyClose"][index]),
            "nextWeekClose": _number(raw["btcNextWeekClose"][index]),
            "nextWeekReturn": _number(raw["btcNextWeekReturn"][index]),
            "periodStatus": "complete",
        }
        for index, week in enumerate(raw["weeks"])
    ]


def load_snapshot(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SnapshotError(f"baseline snapshot does not exist: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SnapshotError(f"cannot read baseline snapshot: {exc}") from exc

    version = raw.get("schemaVersion")
    if version == 2:
        points = _from_v2(raw)
    elif version == 3 and isinstance(raw.get("series"), list):
        points = copy.deepcopy(raw["series"])
    else:
        raise SnapshotError(f"unsupported snapshot schema: {version}")
    if not points:
        raise SnapshotError("baseline snapshot has no weekly points")
    return {"raw": raw, "series": points}


def build_snapshot(
    baseline: dict[str, Any],
    prices: PriceCollection,
    cafes: CafeCollection,
    now: dt.datetime,
    post_refresh_weeks: int = 2,
) -> dict[str, Any]:
    current_day = now.astimezone(KST).date()
    current_week = monday_of(current_day)
    post_cutoff = current_week - dt.timedelta(days=7 * (post_refresh_weeks - 1))
    by_week = {point["week"]: copy.deepcopy(point) for point in baseline["series"]}

    first_week = dt.date.fromisoformat(min(by_week))
    for week in week_range(first_week, current_week):
        by_week.setdefault(
            week,
            {
                "week": week,
                "postCount": 0,
                "btcMean": None,
                "btcClose": None,
                "nextWeekClose": None,
                "nextWeekReturn": None,
                "periodStatus": "complete",
            },
        )

    for week, values in prices.weeks.items():
        point = by_week.setdefault(week, {"week": week, "postCount": 0})
        point["btcMean"] = values["btcMean"]
        point["btcClose"] = values["btcClose"]

    if cafes.counts is not None:
        for week in week_range(post_cutoff, current_week):
            by_week[week]["postCount"] = int(cafes.counts.get(week, 0))

    series = [by_week[week] for week in sorted(by_week)]
    for index, point in enumerate(series):
        week_start = dt.date.fromisoformat(point["week"])
        point["periodStatus"] = (
            "complete" if week_start + dt.timedelta(days=7) <= current_day else "in_progress"
        )
        next_close = (
            _number(series[index + 1].get("btcClose"))
            if index + 1 < len(series)
            else None
        )
        close = _number(point.get("btcClose"))
        point["nextWeekClose"] = next_close
        point["nextWeekReturn"] = (
            next_close / close - 1 if close not in (None, 0) and next_close is not None else None
        )

    latest = next((point for point in reversed(series) if point.get("btcClose") is not None), None)
    if latest is None:
        raise SnapshotError("merged snapshot has no BTC close")

    immutable_cutoff = min(prices.weeks)
    before = {
        point["week"]: (point.get("btcMean"), point.get("btcClose"))
        for point in baseline["series"]
        if point["week"] < immutable_cutoff
    }
    after = {
        point["week"]: (point.get("btcMean"), point.get("btcClose"))
        for point in series
        if point["week"] < immutable_cutoff
    }
    if before != after:
        raise SnapshotError("immutable historical BTC values changed")

    return {
        "schemaVersion": 3,
        "timezone": "Asia/Seoul",
        "weekStart": "MON",
        "updatedAt": now.astimezone(KST).isoformat(),
        "series": series,
        "kpis": {
            "latestWeek": {
                "week": latest["week"],
                "periodStatus": latest["periodStatus"],
                "posts": latest.get("postCount"),
                "btcClose": latest.get("btcClose"),
                "nextWeekReturn": latest.get("nextWeekReturn"),
            }
        },
        "collection": {
            "mode": "incremental",
            "price": {
                "status": "ok",
                "source": "Coinbase Exchange BTC-USD",
                "observedThrough": prices.observed_through,
                "requestedDays": prices.request_days,
            },
            "posts": {
                "status": cafes.status,
                "sourceCount": cafes.source_count,
                "refreshFrom": post_cutoff.isoformat(),
                "failures": list(cafes.failures),
            },
        },
        "meta": {
            "keyword": "비트코인",
            "note": "KST 월요일 기준 주간 집계. 진행 중인 주의 BTC 값은 최신 관측 종가입니다.",
        },
    }


def write_snapshot(path: Path, snapshot: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
