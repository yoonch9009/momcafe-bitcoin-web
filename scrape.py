#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import requests
import datetime as dt
import matplotlib
matplotlib.use("Agg")  # 서버/CI 환경에서 그림 저장용
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from collections import defaultdict
import time
import random
import json
import numpy as np
import pandas as pd
from bs4 import BeautifulSoup
import cryptocompare

# --------------------------------------------------------------------
# 설정
# --------------------------------------------------------------------
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    )
}
OUT_DIR = "docs"  # GitHub Pages가 서빙할 디렉토리
SEARCH_KEYWORD = "비트코인"

# --------------------------------------------------------------------
# 유틸
# --------------------------------------------------------------------
def parse_date_flexibly(value):
    """여러 포맷/타입을 안전하게 날짜로 변환."""
    if value is None:
        return None

    # 타임스탬프(초/밀리초) 숫자형
    if isinstance(value, (int, float)):
        ts = int(value)
        # 밀리초로 보이는 큰 수면 초로 변환
        if ts > 10**12:
            ts = ts // 1000
        try:
            return dt.datetime.fromtimestamp(ts)
        except Exception:
            return None

    # 문자열 파싱
    s = str(value).strip().rstrip(".")
    # HH:MM → 오늘 날짜로 보정
    if len(s) == 5 and s[2] == ":":
        today = dt.date.today()
        try:
            return dt.datetime.strptime(f"{today.year}.{today.month}.{today.day} {s}", "%Y.%m.%d %H:%M")
        except Exception:
            pass

    # 다양한 패턴 시도
    patterns = [
        "%y.%m.%d", "%Y.%m.%d", "%y.%m.%d.", "%Y.%m.%d.",
        "%Y-%m-%d", "%y-%m-%d",
    ]
    for p in patterns:
        try:
            return dt.datetime.strptime(s, p)
        except Exception:
            continue
    return None


# --------------------------------------------------------------------
# 데이터 수집
# --------------------------------------------------------------------
def get_post_dates_from_naver_api(url):
    """네이버 카페 모바일 검색 API에서 게시글 날짜 추출."""
    print(f"[Naver] GET {url}")
    dates = []
    next_params = None
    data = None
    try:
        res = requests.get(url, headers=HEADERS, timeout=20)
        res.raise_for_status()
        data = res.json()
        result = (data or {}).get("message", {}).get("result", {})
        articles = result.get("articleList", []) or []
        print(f" - articles: {len(articles)}")

        for a in articles:
            if a.get("type") != "ARTICLE":
                continue
            item = a.get("item", {}) or {}
            # 후보 키들 중 하나라도 존재하면 사용
            raw = (
                item.get("currentSecTime")
                or item.get("writeDate")
                or item.get("regDate")
                or item.get("wrtDt")
                or item.get("date")
            )
            dt_obj = parse_date_flexibly(raw)
            if dt_obj:
                dates.append(dt_obj)

        next_params = result.get("nextRequestParameter")

    except Exception as e:
        print(f"[Naver] Error: {e}")

    return dates, next_params


def get_post_dates_from_daum_cafe(url, grpid, pagenum):
    """다음 카페 검색 페이지 파싱."""
    print(f"[Daum] GET {url}")
    dates = []
    next_page_params = None
    try:
        res = requests.get(url, headers=HEADERS, timeout=20)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")

        date_elements = soup.select("td.date")
        print(f" - date elements: {len(date_elements)}")

        for el in date_elements:
            date_text = el.get_text(strip=True)
            dt_obj = parse_date_flexibly(date_text)
            if dt_obj:
                dates.append(dt_obj)

        # 페이징: 다음 페이지 유무
        paging = soup.select_one("div.paging")
        if paging:
            links = paging.select("a.num_box")
            last_page_num = None
            if links:
                try:
                    last_page_num = int(links[-1].get_text(strip=True))
                except Exception:
                    pass
            if last_page_num and pagenum < last_page_num:
                next_page_params = {"grpid": grpid, "pagenum": pagenum + 1}

    except Exception as e:
        print(f"[Daum] Error: {e}")

    return dates, next_page_params


def get_bitcoin_prices_cryptocompare(start_date, end_date, api_key):
    """CryptoCompare에서 BTC 일봉 가격 후 주간 평균으로 변환."""
    print("[BTC] Fetch from CryptoCompare (chunked)")
    if api_key:
        # 라이브러리 내부 API 키 설정 (라이브러리 버전에 따라 다를 수 있음)
        try:
            cryptocompare.cryptocompare._set_api_key_parameter(api_key)
        except Exception:
            pass

    all_data = []
    try:
        cursor = start_date
        while cursor < end_date:
            current_end = min(end_date, cursor + dt.timedelta(days=2000))
            limit = (current_end - cursor).days
            to_ts = int(current_end.timestamp())

            data = cryptocompare.get_historical_price_day(
                "BTC", "USD", limit=limit, toTs=to_ts
            )
            if isinstance(data, dict) and data.get("Response") == "Error":
                raise RuntimeError(data.get("Message"))

            all_data.extend(data or [])
            cursor = current_end
            time.sleep(0.5)  # 과한 호출 방지

        # dict -> DataFrame
        price_map = {}
        for item in all_data:
            t = item.get("time")
            c = item.get("close")
            if t is None or c is None:
                continue
            price_map[dt.datetime.fromtimestamp(int(t))] = float(c)

        if not price_map:
            return {}

        df = pd.DataFrame.from_dict(price_map, orient="index", columns=["price"])
        df.index = pd.to_datetime(df.index)
        # 월요일 시작 주차 평균
        df_w = df.resample("W-MON").mean().sort_index()
        return df_w["price"].to_dict()

    except Exception as e:
        print(f"[BTC] Error: {e}")
        return {}


# --------------------------------------------------------------------
# 가공/저장
# --------------------------------------------------------------------
def group_by_week(dates):
    """날짜 목록을 주차(월요일 시작)로 그룹화."""
    weekly = defaultdict(int)
    for d in dates:
        week_start = d - dt.timedelta(days=d.weekday())
        week_start = dt.datetime(week_start.year, week_start.month, week_start.day)
        weekly[week_start] += 1
    return dict(weekly)


def ensure_outdir(path):
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)


def save_outputs(weekly_counts, bitcoin_prices, out_dir):
    """data.json과 chart.png 저장."""
    ensure_outdir(out_dir)

    if not bitcoin_prices:
        raise RuntimeError("비트코인 가격 데이터가 없습니다.")

    # 주차 축 생성(가격 기준으로 통일)
    start = min(pd.to_datetime(list(bitcoin_prices.keys())))
    end = max(pd.to_datetime(list(bitcoin_prices.keys())))
    all_weeks = pd.date_range(start=start, end=end, freq="W-MON")

    # 가격(보간)과 게시글 수(결측 0)
    price_df = pd.DataFrame.from_dict(bitcoin_prices, orient="index", columns=["price"])
    price_df.index = pd.to_datetime(price_df.index)
    price_df = price_df.reindex(all_weeks).interpolate(method="linear")
    prices = price_df["price"].tolist()
    counts = [weekly_counts.get(pd.Timestamp(w).to_pydatetime(), 0) for w in all_weeks]

    # JSON 저장
    payload = {
        "updatedAt": dt.datetime.utcnow().isoformat() + "Z",
        "weeks": [w.strftime("%Y-%m-%d") for w in all_weeks],
        "postCounts": counts,
        "btc": prices,
        "meta": {
            "keyword": SEARCH_KEYWORD,
            "note": "주간 단위(월요일 시작), 가격은 주간 평균.",
        },
    }
    with open(os.path.join(out_dir, "data.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 차트 이미지 저장
    fig, ax1 = plt.subplots(figsize=(12, 6))
    ax1.bar(all_weeks, counts, width=5)  # 색 지정 X (헤드리스 권장 기본)
    ax1.set_xlabel("Week Start (Mon)")
    ax1.set_ylabel("Number of Posts")

    ax2 = ax1.twinx()
    ax2.plot(all_weeks, prices)
    ax2.set_ylabel("BTC Price (USD)")

    ax1.xaxis.set_major_locator(mdates.MonthLocator())
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
    ax1.tick_params(axis="x", rotation=90, labelsize=8)

    fig.tight_layout()
    fig.legend(loc="upper left", bbox_to_anchor=(0, 1), bbox_transform=fig.transFigure)
    fig.savefig(os.path.join(out_dir, "chart.png"), dpi=160)
    plt.close(fig)


# --------------------------------------------------------------------
# 메인
# --------------------------------------------------------------------
def main():
    naver_base_url = "https://apis.naver.com/cafe-web/cafe-mobile/CafeMobileWebArticleSearchListV4"
    naver_cafe_ids = [
        14793916, 14042965, 12448054, 10094499, 22897837, 22897837, 13276223,
        11306253, 18391491, 15194989, 12165814, 18376548, 24361059, 12182370,
        27069107, 26217677, 24000254, 23604018, 26025763,
    ]

    daum_base_url = "https://cafe.daum.net/_c21_/cafesearch"
    daum_cafe_ids = ["ut", "SqBK", "YfAr"]

    all_dates = []

    # --- Naver
    for cafe_id in naver_cafe_ids:
        query = {
            "cafeId": cafe_id,
            "query": SEARCH_KEYWORD,
            "searchBy": 2,      # 제목:1, 내용:2
            "sortBy": "date",
            "page": 1,
            "perPage": 200,     # 1000 → 타임아웃 위험 줄이기
            "adUnit": "MW_CAFE_BOARD",
            "lastItemIndex": 0,
            "lastAdIndex": 0,
            "ad": "true",
        }
        next_params = None
        while True:
            url = naver_base_url + "?" + "&".join(f"{k}={v}" for k, v in query.items())
            if next_params:
                url += "&" + "&".join(f"{k}={v}" for k, v in next_params.items())

            time.sleep(random.uniform(1.2, 3.8))
            dates, next_params = get_post_dates_from_naver_api(url)
            all_dates.extend(dates)

            if not next_params or not next_params.get("page"):
                break
            query["page"] = next_params["page"]
            query["lastAdIndex"] = next_params.get("lastAdIndex", -1)
            query["lastItemIndex"] = next_params.get("lastItemIndex", -1)

    # --- Daum
    for grpid in daum_cafe_ids:
        pagenum = 1
        while True:
            url = (
                f"{daum_base_url}?grpid={grpid}&fldid=&pagenum={pagenum}"
                f"&listnum=50&item=subject&head=&query=%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8"
                f"&attachfile_yn=&media_info=&viewtype=tit&searchPeriod=all&sorttype=0&nickname="
            )
            time.sleep(random.uniform(1.2, 3.8))
            dates, next_params = get_post_dates_from_daum_cafe(url, grpid, pagenum)
            all_dates.extend(dates)
            if not next_params:
                print(f"'{grpid}' 완료")
                break
            pagenum += 1

    if not all_dates:
        print("게시글 데이터가 없습니다. 종료합니다.")
        return

    min_date = min(all_dates)
    end_date = dt.datetime.now()

    api_key = os.environ.get("CRYPTOCOMPARE_API_KEY", "") or "apkkey"
    btc_prices = get_bitcoin_prices_cryptocompare(min_date, end_date, api_key)

    print(f"총 게시글 날짜 개수: {len(all_dates)}")
    weekly_counts = group_by_week(all_dates)
    save_outputs(weekly_counts, btc_prices, OUT_DIR)
    print(f"완료: {OUT_DIR}/data.json, {OUT_DIR}/chart.png 생성")

if __name__ == "__main__":
    main()
