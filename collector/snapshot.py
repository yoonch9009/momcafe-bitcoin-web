from __future__ import annotations

import copy
import datetime as dt
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Any

from .analysis import compute_granger
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
    elif version in (3, 4) and isinstance(raw.get("series"), list):
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
    price_refresh_from = dt.date.fromisoformat(prices.refresh_from)

    first_week = dt.date.fromisoformat(min(by_week))
    for week in week_range(first_week, current_week):
        by_week.setdefault(
            week,
            {
                "week": week,
                "postCount": 0,
                "btcMean": None,
                "btcClose": None,
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
            },
        )

    for week, values in prices.weeks.items():
        point = by_week.setdefault(week, {"week": week, "postCount": 0})
        is_refreshable = dt.date.fromisoformat(week) >= price_refresh_from
        if is_refreshable:
            point["btcMean"] = values["btcMean"]
            point["btcClose"] = values["btcClose"]
        if prices.mode.startswith("history_enrichment") or is_refreshable:
            point["btcOpen"] = values["btcOpen"]
            point["btcHigh"] = values["btcHigh"]
            point["btcLow"] = values["btcLow"]
            point["btcVolume"] = values["btcVolume"]
            point["btcExchangeClose"] = values["btcClose"]
            point["realizedVolatility"] = values["realizedVolatility"]
            point["rangePct"] = values["rangePct"]
            point["priceObservations"] = int(values["observations"])

    if cafes.counts is not None:
        for week in week_range(post_cutoff, current_week):
            by_week[week]["postCount"] = int(cafes.counts.get(week, 0))

    series = [by_week[week] for week in sorted(by_week)]
    for index, point in enumerate(series):
        for field in (
            "btcOpen",
            "btcHigh",
            "btcLow",
            "btcVolume",
            "btcExchangeClose",
            "realizedVolatility",
            "rangePct",
            "priceObservations",
        ):
            point.setdefault(field, None)
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

    immutable_cutoff = prices.refresh_from
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
        "schemaVersion": 4,
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
                "refreshFrom": prices.refresh_from,
                "enrichment": prices.mode,
                "ohlcvCoverage": sum(
                    point.get("btcVolume") is not None for point in series
                ),
                "ohlcvMethod": "coinbase_daily_kst_week_v4",
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
            "note": "KST 월요일 기준 주간 집계. 진행 중인 주의 BTC 값은 최신 관측치이며 확정 주와 분리됩니다.",
            "limitations": [
                "과거 원문이 없어 감성·주제 분석은 제공하지 않습니다.",
                "과거 카페별 집계가 없어 확산도·집중도는 제공하지 않습니다.",
                "통계적 선행성·상관은 경제적 인과를 뜻하지 않습니다.",
            ],
        },
        "analysis": {"granger": compute_granger(series)},
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
