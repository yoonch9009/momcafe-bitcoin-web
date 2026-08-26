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

NAVER_URL = "https://apis.naver.com/cafe-web/cafe-search-api/v2/cafes/{cafe_id}/search/articles"
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
NAVER_HEADERS = {
    **HEADERS,
    "Accept": "application/json",
    "X-Cafe-Product": "mweb",
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
        "query": "비트코인",
        "searchBy": 1,
        "sortBy": "RECENCY",
        "page": 1,
        "perPage": 100,
        "adUnit": "MW_CAFE_BOARD",
        "ad": "true",
        "views": "MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU",
    }
    headers = {
        **NAVER_HEADERS,
        "Referer": f"https://m.cafe.naver.com/ca-fe/web/cafes/{cafe_id}/search",
    }
    dates: list[dt.datetime] = []
    for _ in range(20):
        _nap()
        response = client.get(
            NAVER_URL.format(cafe_id=cafe_id),
            params=params,
            headers=headers,
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), dict):
            raise ValueError("Naver response is missing result")
        result = payload["result"]
        articles = result.get("articleList")
        if not isinstance(articles, list):
            raise ValueError("Naver response is missing articleList")

        page_dates: list[dt.datetime] = []
        for article in articles:
            if not isinstance(article, dict):
                raise ValueError("Naver article is not an object")
            if article.get("type") != "ARTICLE":
                continue
            item = article.get("item")
            if not isinstance(item, dict):
                raise ValueError("Naver article is missing item")
            raw = next(
                (
                    item.get(key)
                    for key in ("addDate", "currentSecTime")
                    if item.get(key) is not None
                ),
                None,
            )
            parsed = parse_cafe_date(raw, now)
            if parsed is None:
                raise ValueError("Naver article has no parseable date")
            page_dates.append(parsed)
        dates.extend(value for value in page_dates if value >= cutoff)
        if page_dates and min(page_dates) < cutoff:
            break

        page_info = result.get("pageInfo")
        if not isinstance(page_info, dict):
            raise ValueError("Naver response is missing pageInfo")
        current_page = int(params["page"])
        last_page = int(page_info.get("lastNavigationPageNumber") or current_page)
        if current_page >= last_page:
            break

        next_params = result.get("nextRequestParameter") or {}
        next_page = int(next_params.get("page") or 0)
        if next_page <= current_page:
            raise ValueError("Naver pagination did not advance")
        params["page"] = next_page
        for key in ("lastItemIndex", "lastAdIndex", "placementType"):
            if key in next_params:
                params[key] = next_params[key]
    else:
        raise ValueError("Naver pagination limit exceeded")
    return dates


def _daum_dates(
    client: requests.Session,
    cafe_id: str,
    cutoff: dt.datetime,
    now: dt.datetime,
) -> list[dt.datetime]:
    dates: list[dt.datetime] = []
    for page in range(1, 101):
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

        page_numbers = [
            int(element.get_text(strip=True))
            for element in soup.select("div.paging a.num_box")
            if element.get_text(strip=True).isdigit()
        ]
        last_page = max(page_numbers, default=1)
        if page >= last_page:
            break
    else:
        raise ValueError("Daum pagination limit exceeded")
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
