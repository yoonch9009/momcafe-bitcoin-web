from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
UTC = dt.timezone.utc


def monday_of(value: dt.date | dt.datetime) -> dt.date:
    day = value.date() if isinstance(value, dt.datetime) else value
    return day - dt.timedelta(days=day.weekday())


def parse_cafe_date(value: object, now: dt.datetime) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        timestamp = int(value)
        if timestamp > 10**12:
            timestamp //= 1000
        try:
            return dt.datetime.fromtimestamp(timestamp, tz=KST)
        except (OverflowError, OSError, ValueError):
            return None

    text = str(value).strip().rstrip(".")
    if len(text) == 5 and text[2] == ":":
        text = f"{now:%Y.%m.%d} {text}"
        formats = ("%Y.%m.%d %H:%M",)
    else:
        formats = ("%y.%m.%d", "%Y.%m.%d", "%Y-%m-%d", "%y-%m-%d")
    for date_format in formats:
        try:
            return dt.datetime.strptime(text, date_format).replace(tzinfo=KST)
        except ValueError:
            continue
    return None


def iso_week(value: dt.date | dt.datetime) -> str:
    return monday_of(value).isoformat()


def week_range(start: dt.date, end: dt.date) -> list[str]:
    cursor = monday_of(start)
    final = monday_of(end)
    result: list[str] = []
    while cursor <= final:
        result.append(cursor.isoformat())
        cursor += dt.timedelta(days=7)
    return result
