from __future__ import annotations

import datetime as dt
import unittest
from typing import Any

from collector.cafes import _daum_dates, _naver_dates
from collector.time_utils import KST, parse_cafe_date


class FakeResponse:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.text = payload if isinstance(payload, str) else ""

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self.payload


class FakeSession:
    def __init__(self, *payloads: object) -> None:
        self.responses = [FakeResponse(payload) for payload in payloads]
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return self.responses.pop(0)


class NaverCafeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = dt.datetime(2026, 8, 26, 12, tzinfo=KST)
        self.cutoff = dt.datetime(2026, 8, 17, tzinfo=KST)

    def test_iso_article_date_is_interpreted_as_korea_time(self) -> None:
        parsed = parse_cafe_date("2026-08-25T09:41:08.35", self.now)
        self.assertEqual(parsed, dt.datetime(2026, 8, 25, 9, 41, 8, 350000, KST))

    def test_v2_search_collects_recent_articles_and_uses_mobile_contract(self) -> None:
        session = FakeSession(
            {
                "result": {
                    "articleList": [
                        {
                            "type": "ARTICLE",
                            "item": {"addDate": "2026-08-25T09:41:08.35"},
                        },
                        {
                            "type": "ARTICLE",
                            "item": {"addDate": "2026-08-06T09:57:59.817"},
                        },
                    ],
                    "pageInfo": {"lastNavigationPageNumber": 2},
                    "nextRequestParameter": {"page": 2},
                }
            }
        )

        dates = _naver_dates(session, 22897837, self.cutoff, self.now)

        self.assertEqual(dates, [dt.datetime(2026, 8, 25, 9, 41, 8, 350000, KST)])
        self.assertEqual(len(session.calls), 1)
        call = session.calls[0]
        self.assertIn("/v2/cafes/22897837/search/articles", call["url"])
        self.assertEqual(call["params"]["sortBy"], "RECENCY")
        self.assertEqual(call["headers"]["X-Cafe-Product"], "mweb")

    def test_valid_empty_article_list_is_a_real_zero(self) -> None:
        session = FakeSession(
            {
                "result": {
                    "articleList": [],
                    "pageInfo": {"lastNavigationPageNumber": 1},
                }
            }
        )

        self.assertEqual(_naver_dates(session, 14793916, self.cutoff, self.now), [])

    def test_pagination_keeps_page_size_and_uses_next_page_indexes(self) -> None:
        session = FakeSession(
            {
                "result": {
                    "articleList": [
                        {
                            "type": "ARTICLE",
                            "item": {"addDate": "2026-08-25T09:41:08.35"},
                        }
                    ],
                    "pageInfo": {"lastNavigationPageNumber": 2},
                    "nextRequestParameter": {
                        "page": 2,
                        "perPage": 0,
                        "lastItemIndex": 100,
                        "lastAdIndex": 20,
                        "placementType": "CAFE_SECTION_SEARCH",
                    },
                }
            },
            {
                "result": {
                    "articleList": [
                        {
                            "type": "ARTICLE",
                            "item": {"addDate": "2026-08-01T09:41:08.35"},
                        }
                    ],
                    "pageInfo": {"lastNavigationPageNumber": 2},
                }
            },
        )

        dates = _naver_dates(session, 22897837, self.cutoff, self.now)

        self.assertEqual(len(dates), 1)
        second_params = session.calls[1]["params"]
        self.assertEqual(second_params["page"], 2)
        self.assertEqual(second_params["perPage"], 100)
        self.assertEqual(second_params["lastItemIndex"], 100)
        self.assertEqual(second_params["placementType"], "CAFE_SECTION_SEARCH")

    def test_changed_response_shape_fails_instead_of_becoming_zero(self) -> None:
        session = FakeSession({"result": {"pageInfo": {"lastNavigationPageNumber": 1}}})

        with self.assertRaisesRegex(ValueError, "articleList"):
            _naver_dates(session, 14793916, self.cutoff, self.now)

    def test_daum_stops_at_declared_last_page_instead_of_repeating_it(self) -> None:
        def page(date: str, current: int, last: int) -> str:
            return f"""
                <table><tr><td class="date">{date}</td></tr></table>
                <div class="paging">
                    <a class="num_box">{current}</a>
                    <a class="num_box last_pg_box">{last}</a>
                </div>
            """

        session = FakeSession(page("26.08.25.", 1, 2), page("26.08.18.", 2, 2))

        dates = _daum_dates(
            session,
            "ut",
            dt.datetime(2016, 3, 7, tzinfo=KST),
            self.now,
        )

        self.assertEqual(len(dates), 2)
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(session.calls[-1]["params"]["pagenum"], 2)


if __name__ == "__main__":
    unittest.main()
