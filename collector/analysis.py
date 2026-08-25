from __future__ import annotations

import contextlib
import io
import math
from typing import Any

import numpy as np
from statsmodels.tsa.stattools import adfuller, grangercausalitytests


def _finite(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _stationary_rows(series: list[dict[str, Any]]) -> tuple[np.ndarray, list[str]]:
    rows: list[list[float]] = []
    weeks: list[str] = []
    previous_posts: float | None = None
    previous_close: float | None = None
    for point in series:
        posts = _finite(point.get("postCount"))
        close = _finite(point.get("btcClose"))
        if posts is None or close is None or close <= 0:
            previous_posts, previous_close = posts, close
            continue
        if previous_posts is not None and previous_close not in (None, 0):
            attention_change = math.log1p(posts) - math.log1p(previous_posts)
            price_return = math.log(close / previous_close)  # type: ignore[operator]
            rows.append([attention_change, price_return])
            weeks.append(str(point["week"]))
        previous_posts, previous_close = posts, close
    return np.asarray(rows, dtype=float), weeks


def _bh_adjust(p_values: list[float]) -> list[float]:
    count = len(p_values)
    order = sorted(range(count), key=p_values.__getitem__)
    adjusted = [1.0] * count
    running = 1.0
    for rank_index in range(count - 1, -1, -1):
        original_index = order[rank_index]
        rank = rank_index + 1
        running = min(running, p_values[original_index] * count / rank)
        adjusted[original_index] = min(1.0, running)
    return adjusted


def compute_granger(series: list[dict[str, Any]], max_lag: int = 4) -> dict[str, Any]:
    values, weeks = _stationary_rows(series)
    if len(values) < max(40, max_lag * 10):
        return {"status": "insufficient_data", "observations": int(len(values)), "tests": []}

    tests: list[dict[str, Any]] = []
    directions = (
        ("attention_to_return", values[:, [1, 0]]),
        ("return_to_attention", values[:, [0, 1]]),
    )
    for direction, matrix in directions:
        with contextlib.redirect_stdout(io.StringIO()):
            results = grangercausalitytests(matrix, maxlag=max_lag)
        for lag in range(1, max_lag + 1):
            statistic, p_value, _, _ = results[lag][0]["ssr_ftest"]
            tests.append(
                {
                    "direction": direction,
                    "lag": lag,
                    "fStatistic": float(statistic),
                    "pValue": float(p_value),
                }
            )

    adjusted = _bh_adjust([test["pValue"] for test in tests])
    for test, q_value in zip(tests, adjusted):
        test["qValue"] = q_value

    return {
        "status": "ok",
        "observations": int(len(values)),
        "period": {"from": weeks[0], "through": weeks[-1]},
        "transform": "weekly diff(log1p(posts)) and log(close_t/close_t-1)",
        "adfPValues": {
            "attentionChange": float(adfuller(values[:, 0], autolag="AIC")[1]),
            "btcReturn": float(adfuller(values[:, 1], autolag="AIC")[1]),
        },
        "multipleTesting": "Benjamini-Hochberg FDR across both directions and lags",
        "tests": tests,
        "note": "Granger precedence is not proof of economic causality.",
    }
