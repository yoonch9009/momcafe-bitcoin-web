from __future__ import annotations

import datetime as dt
import random
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any

import requests
from bs4 import BeautifulSoup

from .time_utils import KST, iso_week, parse_cafe_date

NAVER_URL = "https://apis.naver.com/cafe-web/cafe-mobile/CafeMobileWebArticleSearchListV4"
DAUM_URL = "https://cafe.daum.net/_c21_/cafesearch"
NAVER_IDS = (
    14793916,
    14042965,
    12448054,
    10094499,
    22897837,
    13276223,
    11306253,
    18391491,
    15194989,
    12165814,
    18376548,
    24361059,
    12182370,
    27069107,
    26217677,
    24000254,
    23604018,
    26025763,
)
DAUM_IDS = ("ut", "SqBK", "YfAr")
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


@dataclass(frozen=True)
class CafeCollection:
    counts: dict[str, int] | None
    status: str
    failures: tuple[str, ...]
    source_count: int


def _nap() -> None:
    time.sleep(random.uniform(0.45, 0.9))


def _naver_dates(
    client: requests.Session,
    cafe_id: int,
    cutoff: dt.datetime,
    now: dt.datetime,
) -> list[dt.datetime]:
    params: dict[str, Any] = {
        "cafeId": cafe_id,
        "query": "비트코인",
        "searchBy": 2,
        "sortBy": "date",
        "page": 1,
        "perPage": 200,
        "adUnit": "MW_CAFE_BOARD",
        "lastItemIndex": 0,
        "lastAdIndex": 0,
        "ad": "true",
    }
    dates: list[dt.datetime] = []
    for _ in range(20):
        _nap()
        response = client.get(NAVER_URL, params=params, headers=HEADERS, timeout=20)
        response.raise_for_status()
        result = response.json().get("message", {}).get("result", {})
        page_dates: list[dt.datetime] = []
        for article in result.get("articleList", []) or []:
            if article.get("type") != "ARTICLE":
                continue
            item = article.get("item", {}) or {}
            raw = next(
                (
                    item.get(key)
                    for key in ("writeDate", "regDate", "wrtDt", "date", "currentSecTime")
                    if item.get(key) is not None
                ),
                None,
            )
            parsed = parse_cafe_date(raw, now)
            if parsed:
                page_dates.append(parsed)
        dates.extend(value for value in page_dates if value >= cutoff)
        if page_dates and min(page_dates) < cutoff:
            break
        next_params = result.get("nextRequestParameter") or {}
        if not next_params.get("page"):
            break
        params.update(next_params)
    return dates


def _daum_dates(
    client: requests.Session,
    cafe_id: str,
    cutoff: dt.datetime,
    now: dt.datetime,
) -> list[dt.datetime]:
    dates: list[dt.datetime] = []
    for page in range(1, 21):
        _nap()
        response = client.get(
            DAUM_URL,
            params={
                "grpid": cafe_id,
                "pagenum": page,
                "listnum": 50,
                "item": "subject",
                "query": "비트코인",
                "viewtype": "tit",
                "searchPeriod": "all",
                "sorttype": 0,
            },
            headers=HEADERS,
            timeout=20,
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        page_dates = [
            parsed
            for element in soup.select("td.date")
            if (parsed := parse_cafe_date(element.get_text(strip=True), now))
        ]
        dates.extend(value for value in page_dates if value >= cutoff)
        if not page_dates or min(page_dates) < cutoff:
            break
    return dates


def collect_recent_posts(
    now: dt.datetime,
    cutoff: dt.datetime,
    session: requests.Session | None = None,
) -> CafeCollection:
    client = session or requests.Session()
    dates: list[dt.datetime] = []
    failures: list[str] = []
    for cafe_id in NAVER_IDS:
        try:
            dates.extend(_naver_dates(client, cafe_id, cutoff, now))
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"naver:{cafe_id}:{type(exc).__name__}")
    for cafe_id in DAUM_IDS:
        try:
            dates.extend(_daum_dates(client, cafe_id, cutoff, now))
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"daum:{cafe_id}:{type(exc).__name__}")

    total_sources = len(NAVER_IDS) + len(DAUM_IDS)
    if failures or not dates:
        reason = tuple(failures or ["all-sources:no-recent-results"])
        return CafeCollection(None, "degraded", reason, total_sources)

    counts = Counter(iso_week(value.astimezone(KST)) for value in dates)
    return CafeCollection(dict(counts), "ok", (), total_sources)
