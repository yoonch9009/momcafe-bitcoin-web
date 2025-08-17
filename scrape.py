#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import time
import json
import random
import requests
import datetime as dt
import pandas as pd
from bs4 import BeautifulSoup
from collections import defaultdict
from zoneinfo import ZoneInfo
import cryptocompare
import math

KST = ZoneInfo("Asia/Seoul")
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    )
}
OUT_DIR = "docs"
SEARCH_KEYWORD = "비트코인"

# ------------------------- 유틸/파서 -------------------------
def parse_date_kst(value):
    """여러 포맷을 KST aware datetime으로 변환."""
    if value is None:
        return None

    # 숫자형(초/밀리초) 유닉스 타임스탬프
    if isinstance(value, (int, float)):
        ts = int(value)
        if ts > 10**12:  # 밀리초 → 초
            ts //= 1000
        try:
            return dt.datetime.fromtimestamp(ts, tz=KST)
        except Exception:
            return None

    s = str(value).strip().rstrip(".")
    # "HH:MM" (오늘 시각으로 간주)
    if len(s) == 5 and s[2] == ":":
        today = dt.datetime.now(tz=KST).date()
        try:
            return dt.datetime.strptime(f"{today.year}.{today.month}.{today.day} {s}", "%Y.%m.%d %H:%M").replace(tzinfo=KST)
        except Exception:
            pass

    patterns = [
        "%y.%m.%d", "%Y.%m.%d", "%y.%m.%d.", "%Y.%m.%d.",
        "%Y-%m-%d", "%y-%m-%d",
    ]
    for p in patterns:
        try:
            d = dt.datetime.strptime(s, p)
            return d.replace(tzinfo=KST)
        except Exception:
            continue
    return None

# ------------------------- 수집부 -------------------------
def get_post_dates_from_naver_api(url):
    dates = []
    next_params = None
    try:
        res = requests.get(url, headers=HEADERS, timeout=20)
        res.raise_for_status()
        data = res.json()
        result = (data or {}).get("message", {}).get("result", {})
        articles = result.get("articleList", []) or []
        for a in articles:
            if a.get("type") != "ARTICLE":
                continue
            item = a.get("item", {}) or {}
            raw = (
                item.get("currentSecTime")
                or item.get("writeDate")
                or item.get("regDate")
                or item.get("wrtDt")
                or item.get("date")
            )
            dt_obj = parse_date_kst(raw)
            if dt_obj:
                dates.append(dt_obj)
        next_params = result.get("nextRequestParameter")
    except Exception as e:
        print(f"[Naver] Error: {e}")
    return dates, next_params

def get_post_dates_from_daum_cafe(url, grpid, pagenum):
    dates = []
    next_page_params = None
    try:
        res = requests.get(url, headers=HEADERS, timeout=20)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")
        for el in soup.select("td.date"):
            dt_obj = parse_date_kst(el.get_text(strip=True))
            if dt_obj:
                dates.append(dt_obj)
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

def get_btc_daily_close_kst(start_dt, end_dt, api_key):
    """CryptoCompare 일봉(UTC)을 받아 KST 종가 시계열(DataFrame)을 반환."""
    if api_key:
        try:
            cryptocompare.cryptocompare._set_api_key_parameter(api_key)
        except Exception:
            pass

    all_rows = []
    cursor = start_dt
    # 하루 단위로 충분히 넉넉(2000일) 호출
    while cursor < end_dt:
        chunk_end = min(end_dt, cursor + dt.timedelta(days=2000))
        limit = (chunk_end - cursor).days
        to_ts = int(chunk_end.timestamp())  # UTC 기준
        data = cryptocompare.get_historical_price_day("BTC", "USD", limit=limit, toTs=to_ts)
        if isinstance(data, dict) and data.get("Response") == "Error":
            raise RuntimeError(data.get("Message"))
        all_rows.extend(data or [])
        cursor = chunk_end
        time.sleep(0.4)

    if not all_rows:
        return pd.DataFrame(columns=["close"])

    # UTC→KST 로 변환해 index 구성
    utc_times = pd.to_datetime([r["time"] for r in all_rows], unit="s", utc=True)
    kst_times = utc_times.tz_convert(KST)
    closes = [float(r["close"]) for r in all_rows]
    df = pd.DataFrame({"close": closes}, index=kst_times).sort_index()
    return df

# ------------------------- 집계/동기화 -------------------------
def posts_to_weekly_counts_kst(post_datetimes):
    """주차(월요일 시작, 좌폐구간)로 카운트."""
    if not post_datetimes:
        return pd.Series(dtype="int64")
    idx = pd.to_datetime(post_datetimes)
    # 이미 tz-aware 라면 그대로, 아니라면 KST로 지역화
    if idx.tz is None:
        idx = idx.tz_localize(KST)
    s = pd.Series(1, index=idx)
    weekly = s.resample("W-MON", label="left", closed="left").sum().astype("int64")
    return weekly

def btc_to_weekly(df_daily_close_kst):
    """BTC 일봉 → 주간 지표(평균, 종가, 다음주 종가/수익률)"""
    if df_daily_close_kst.empty:
        return (pd.Series(dtype="float64"),)*4

    # 주간 평균가/종가
    weekly_mean = df_daily_close_kst["close"].resample("W-MON", label="left", closed="left").mean()
    weekly_close = df_daily_close_kst["close"].resample("W-MON", label="left", closed="left").last()

    # 다음주 종가/수익률(예측 관점용)
    next_week_close = weekly_close.shift(-1)
    next_week_return = (next_week_close / weekly_close - 1.0)

    return weekly_mean, weekly_close, next_week_close, next_week_return

def align_weeks(posts_weekly, *btc_weeklies):
    """주차 인덱스를 합집합으로 맞추되,
       - 게시글은 결측 0
       - BTC는 결측 NaN (보간/미래참조 방지)
    """
    all_index = posts_weekly.index
    for s in btc_weeklies:
        all_index = all_index.union(s.index)
    all_index = all_index.sort_values()

    posts_aligned = posts_weekly.reindex(all_index).fillna(0).astype("int64")
    btc_aligned = [s.reindex(all_index) for s in btc_weeklies]
    return (all_index, posts_aligned, *btc_aligned)

# ------------------------- 저장 -------------------------
def _to_jsonable_list(seq):
    out = []
    for v in list(seq):
        # None, NaN, +/-Inf -> None으로
        if v is None:
            out.append(None)
            continue
        try:
            fv = float(v)
            if math.isnan(fv) or math.isinf(fv):
                out.append(None)
            else:
                out.append(fv)
        except Exception:
            out.append(None)
    return out

def _num_or_none(x):
    """숫자면 float로, 아니면 None( NaN/Inf 포함 )."""
    if x is None:
        return None
    try:
        xv = float(x)
        if math.isnan(xv) or math.isinf(xv):
            return None
        return xv
    except Exception:
        return None

def save_json(out_path, index, posts, w_mean, w_close, next_close, next_ret):
    weeks = [pd.Timestamp(i).strftime("%Y-%m-%d") for i in index]
    post_list = _to_jsonable_list(posts.tolist())
    mean_list = _to_jsonable_list(w_mean.tolist())
    close_list = _to_jsonable_list(w_close.tolist())
    nclose_list = _to_jsonable_list(next_close.tolist())
    nret_list   = _to_jsonable_list(next_ret.tolist())

    payload = {
        "schemaVersion": 2,
        "tz": "Asia/Seoul",
        "weekStart": "MON",
        "updatedAt": dt.datetime.now(tz=KST).isoformat(),
        "weeks": weeks,
        "postCounts": post_list,
        "btcWeeklyMean": mean_list,
        "btcWeeklyClose": close_list,
        "btcNextWeekClose": nclose_list,
        "btcNextWeekReturn": nret_list,
        "meta": {
            "keyword": "비트코인",
            "note": "BTC는 UTC→KST 변환 후 주간 집계. 가격 결측은 null로 직렬화.",
        },
        "kpis": {}
    }

    # KPI: 널-세이프 계산
    # 최근 '완결 주'(게시글 수, 주간 종가가 모두 유효한 인덱스) 찾기
    valid_idx = [i for i in range(len(weeks))
                 if _num_or_none(close_list[i]) is not None and _num_or_none(post_list[i]) is not None]
    if valid_idx:
        last_idx = valid_idx[-1]
        payload["kpis"]["lastWeek"] = {
            "week": weeks[last_idx],
            "posts": int(post_list[last_idx]) if _num_or_none(post_list[last_idx]) is not None else None,
            "btcClose": _num_or_none(close_list[last_idx]),
            # 다음 주 수익률은 없을 수 있으므로 그대로 안전 처리
            "nextWeekReturn": _num_or_none(nret_list[last_idx]),
        }

    # NaN/Inf가 남아있으면 파일 쓰기 단계에서 막기
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)

# ------------------------- 메인 -------------------------
def main():
    naver_base = "https://apis.naver.com/cafe-web/cafe-mobile/CafeMobileWebArticleSearchListV4"
    naver_ids = [
        14793916, 14042965, 12448054, 10094499, 22897837, 22897837, 13276223,
        11306253, 18391491, 15194989, 12165814, 18376548, 24361059, 12182370,
        27069107, 26217677, 24000254, 23604018, 26025763,
    ]
    daum_base = "https://cafe.daum.net/_c21_/cafesearch"
    daum_ids = ["ut", "SqBK", "YfAr"]

    # 1) 카페 수집
    all_dates = []
    for cafe_id in naver_ids:
        q = {
            "cafeId": cafe_id, "query": SEARCH_KEYWORD, "searchBy": 2,
            "sortBy": "date", "page": 1, "perPage": 200,
            "adUnit": "MW_CAFE_BOARD", "lastItemIndex": 0, "lastAdIndex": 0, "ad": "true"
        }
        next_params = None
        while True:
            url = naver_base + "?" + "&".join(f"{k}={v}" for k, v in q.items())
            if next_params:
                url += "&" + "&".join(f"{k}={v}" for k, v in next_params.items())
            time.sleep(random.uniform(1.2, 3.8))
            dates, next_params = get_post_dates_from_naver_api(url)
            all_dates.extend(dates)
            if not next_params or not next_params.get("page"):
                break
            q["page"] = next_params["page"]
            q["lastAdIndex"] = next_params.get("lastAdIndex", -1)
            q["lastItemIndex"] = next_params.get("lastItemIndex", -1)

    for grpid in daum_ids:
        pagenum = 1
        while True:
            url = (
                f"{daum_base}?grpid={grpid}&fldid=&pagenum={pagenum}"
                "&listnum=50&item=subject&head=&query=%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8"
                "&attachfile_yn=&media_info=&viewtype=tit&searchPeriod=all&sorttype=0&nickname="
            )
            time.sleep(random.uniform(1.2, 3.8))
            dates, next_params = get_post_dates_from_daum_cafe(url, grpid, pagenum)
            all_dates.extend(dates)
            if not next_params:
                break
            pagenum += 1

    if not all_dates:
        print("게시글 데이터 없음. 종료.")
        return

    start_dt = min(all_dates).astimezone(KST) - dt.timedelta(days=2)
    end_dt = dt.datetime.now(tz=KST) + dt.timedelta(days=1)

    posts_weekly = posts_to_weekly_counts_kst(all_dates)

    api_key = os.environ.get("CRYPTOCOMPARE_API_KEY", "") or "apkkey"
    btc_daily = get_btc_daily_close_kst(start_dt, end_dt, api_key)
    w_mean, w_close, next_close, next_ret = btc_to_weekly(btc_daily)

    index, posts_aln, w_mean_aln, w_close_aln, next_close_aln, next_ret_aln = align_weeks(
        posts_weekly, w_mean, w_close, next_close, next_ret
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    save_json(os.path.join(OUT_DIR, "data.json"), index, posts_aln,
              w_mean_aln, w_close_aln, next_close_aln, next_ret_aln)

    print(f"완료: {OUT_DIR}/data.json 생성 (주간 동기화, look-ahead 안전 지표 포함)")

if __name__ == "__main__":
    main()
