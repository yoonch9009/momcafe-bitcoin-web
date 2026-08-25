"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Download,
  FileWarning,
  Hash,
  Moon,
  RefreshCw,
  Sun,
  TrendingUp,
} from "lucide-react";

import type { Metric, TimelinePoint } from "@/components/dashboard-charts";
import {
  assetPath,
  parseSnapshot,
  type DashboardSnapshot,
} from "@/lib/dashboard-data";
import { laggedReturns, pearson, relativeChange } from "@/lib/statistics";

const TimelineChart = dynamic(
  () =>
    import("@/components/dashboard-charts").then(
      (module) => module.TimelineChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
const CorrelationChart = dynamic(
  () =>
    import("@/components/dashboard-charts").then(
      (module) => module.CorrelationChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

type Range = "1y" | "3y" | "all";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function ChartSkeleton() {
  return (
    <div className="loading-grid">
      <div className="loading-mark" aria-label="차트 로딩 중" />
    </div>
  );
}

function formatKst(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function rangeLength(range: Range) {
  return range === "1y" ? 52 : range === "3y" ? 156 : Number.POSITIVE_INFINITY;
}

export function DashboardShell() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("close");
  const [range, setRange] = useState<Range>("3y");
  const [horizon, setHorizon] = useState(1);
  const [logarithmic, setLogarithmic] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const controller = new AbortController();
    fetch(assetPath("/data.json"), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((value) => setSnapshot(parseSnapshot(value)))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(reason instanceof Error ? reason.message : "알 수 없는 오류");
      });
    return () => controller.abort();
  }, []);

  const visibleSeries = useMemo(() => {
    if (!snapshot) return [];
    const length = rangeLength(range);
    return Number.isFinite(length)
      ? snapshot.series.slice(-length)
      : snapshot.series;
  }, [range, snapshot]);

  const timeline = useMemo<TimelinePoint[]>(
    () =>
      visibleSeries.map((point) => ({
        week: point.week,
        posts: point.postCount,
        value:
          metric === "close"
            ? point.btcClose
            : metric === "mean"
              ? point.btcMean
              : point.nextWeekReturn === null
                ? null
                : point.nextWeekReturn * 100,
      })),
    [metric, visibleSeries],
  );

  const scatter = useMemo(
    () => laggedReturns(visibleSeries, horizon),
    [horizon, visibleSeries],
  );
  const correlation = useMemo(
    () =>
      pearson(scatter.map((point) => [point.posts, point.returnPct] as const)),
    [scatter],
  );

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <section className="surface max-w-xl p-8 text-center">
          <FileWarning
            className="mx-auto text-[var(--orange)]"
            aria-hidden="true"
            size={34}
          />
          <p className="eyebrow mt-5">DATA CONTRACT ERROR</p>
          <h1 className="mt-3 text-3xl font-semibold">
            데이터를 불러오지 못했습니다.
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">{error}</p>
          <button
            className="button-primary mx-auto mt-6"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} /> 다시 불러오기
          </button>
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="loading-grid min-h-screen">
        <div className="loading-copy">
          <div className="loading-mark" />
          <p className="eyebrow">LOADING SIGNALS</p>
        </div>
      </main>
    );
  }

  const latest = [...snapshot.series]
    .reverse()
    .find((point) => point.btcClose !== null)!;
  const previous = [...snapshot.series]
    .slice(0, snapshot.series.indexOf(latest))
    .reverse()
    .find((point) => point.btcClose !== null);
  const priceChange = relativeChange(
    latest.btcClose,
    previous?.btcClose ?? null,
  );
  const postStatus = snapshot.collection.posts.status;
  const isLive = latest.periodStatus === "in_progress";

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("btc-dashboard-theme", next);
  }

  return (
    <div className="dashboard-shell">
      <div className="page-grid" />
      <header className="container topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            ₿
          </div>
          <div className="brand-copy">
            <strong>SIGNAL DESK</strong>
            <span>MOM CAFE × BITCOIN</span>
          </div>
        </div>
        <div className="top-actions">
          <a className="download-link" download href={assetPath("/data.json")}>
            <Download aria-hidden="true" size={15} />
            <span>데이터</span>
          </a>
          <button
            className="icon-button"
            onClick={toggleTheme}
            title="테마 전환"
            type="button"
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" size={16} />
            ) : (
              <Moon aria-hidden="true" size={16} />
            )}
            <span className="sr-only">테마 전환</span>
          </button>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div>
            <p className="eyebrow">WEEKLY ATTENTION INDEX · KST</p>
            <h1>
              사람들의 대화와
              <br />
              <em>비트코인의 궤적.</em>
            </h1>
            <p className="hero-copy">
              맘카페의 ‘비트코인’ 언급량과 BTC-USD 가격을 같은 주간 축에
              놓았습니다. 분위기가 가격을 앞서는지, 가격이 대화를 만드는지 직접
              탐색해 보세요.
            </p>
          </div>
          <aside className="status-panel" aria-label="데이터 상태">
            <div className="status-row">
              <span>가격 관측일</span>
              <strong className="status-value">
                {snapshot.collection.price.observedThrough}
              </strong>
            </div>
            <div className="status-row">
              <span>가격 파이프라인</span>
              <strong className="status-value">
                <i className="status-dot" />
                정상
              </strong>
            </div>
            <div className="status-row">
              <span>카페 파이프라인</span>
              <strong className="status-value">
                <i className={`status-dot ${postStatus}`} />
                {postStatus === "ok" ? "정상" : "기존값 보존"}
              </strong>
            </div>
            <div className="status-row">
              <span>갱신 방식</span>
              <strong className="status-value">INCREMENTAL</strong>
            </div>
          </aside>
        </section>

        <section className="kpi-grid" aria-label="핵심 지표">
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>BTC-USD 최신 관측</span>
              <span className="kpi-icon">
                <TrendingUp size={16} />
              </span>
            </div>
            <div className="kpi-value">{usd.format(latest.btcClose!)}</div>
            <div className="kpi-foot">
              {priceChange !== null ? (
                priceChange >= 0 ? (
                  <ArrowUpRight className="trend-up" size={14} />
                ) : (
                  <ArrowDownRight className="trend-down" size={14} />
                )
              ) : null}
              <span
                className={
                  priceChange !== null && priceChange >= 0
                    ? "trend-up"
                    : "trend-down"
                }
              >
                {priceChange === null
                  ? "-"
                  : `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%`}
              </span>
              <span>전주 관측 대비</span>
              {isLive ? <span className="live-pill">LIVE WEEK</span> : null}
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>최근 주 언급량</span>
              <span className="kpi-icon">
                <Hash size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {integer.format(latest.postCount)}
              <small className="ml-2 text-sm text-[var(--muted)]">건</small>
            </div>
            <div className="kpi-foot">
              <CalendarClock size={13} />
              <span>{latest.week} 시작 주</span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>선행 상관계수</span>
              <span className="kpi-icon">
                <Activity size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {correlation === null ? "—" : correlation.toFixed(3)}
            </div>
            <div className="kpi-foot">
              <span>
                언급(t) → 수익률(t+{horizon}) ·{" "}
                {range === "all" ? "전체" : range.toUpperCase()}
              </span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>마지막 갱신</span>
              <span className="kpi-icon">
                <RefreshCw size={16} />
              </span>
            </div>
            <div className="kpi-value text-[clamp(18px,2vw,27px)]">
              {formatKst(snapshot.updatedAt)}
            </div>
            <div className="kpi-foot">
              <span>{snapshot.collection.price.source}</span>
            </div>
          </article>
        </section>

        <section className="surface chart-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">TIMELINE</p>
              <h2>언급량과 가격 흐름</h2>
              <p className="section-note">
                막대는 주간 언급량, 선은 선택한 BTC 지표입니다. 현재 주는
                마감값이 아닌 최신 관측값입니다.
              </p>
            </div>
            <div className="control-row">
              <select
                aria-label="가격 지표"
                className="select-control"
                onChange={(event) => setMetric(event.target.value as Metric)}
                value={metric}
              >
                <option value="close">주간 종가</option>
                <option value="mean">주간 평균</option>
                <option value="nextReturn">다음 주 수익률</option>
              </select>
              <select
                aria-label="조회 기간"
                className="select-control"
                onChange={(event) => setRange(event.target.value as Range)}
                value={range}
              >
                <option value="1y">최근 1년</option>
                <option value="3y">최근 3년</option>
                <option value="all">전체</option>
              </select>
              <button
                className={`toggle-button ${logarithmic ? "active" : ""}`}
                disabled={metric === "nextReturn"}
                onClick={() => setLogarithmic((value) => !value)}
                type="button"
              >
                <BarChart3 size={14} /> 로그 축
              </button>
            </div>
          </div>
          <div className="chart-wrap">
            <TimelineChart
              data={timeline}
              logarithmic={logarithmic}
              metric={metric}
            />
          </div>
        </section>

        <section className="analysis-grid">
          <article className="surface analysis-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">LEAD / LAG</p>
                <h2>언급량과 이후 수익률</h2>
                <p className="section-note">
                  각 점은 한 주입니다. x축은 그 주의 언급량, y축은 선택한 미래
                  시점까지의 BTC 수익률입니다.
                </p>
              </div>
              <select
                aria-label="예측 지평"
                className="select-control"
                onChange={(event) => setHorizon(Number(event.target.value))}
                value={horizon}
              >
                {[1, 2, 3, 4, 6, 8].map((value) => (
                  <option key={value} value={value}>
                    +{value}주
                  </option>
                ))}
              </select>
            </div>
            <div className="chart-wrap">
              <CorrelationChart data={scatter} />
            </div>
          </article>
          <aside className="surface analysis-card">
            <p className="eyebrow">PEARSON R</p>
            <h2 className="mt-2 text-xl font-semibold">상관 강도</h2>
            <div className="corr-value">
              {correlation === null ? "—" : correlation.toFixed(2)}
            </div>
            <div className="corr-scale">
              <span>-1.0</span>
              <span>0</span>
              <span>+1.0</span>
            </div>
            <div className="corr-track">
              <i
                className="corr-marker"
                style={{
                  left: `${correlation === null ? 50 : Math.max(0, Math.min(100, (correlation + 1) * 50))}%`,
                }}
              />
            </div>
            <ul className="method-list">
              <li>
                <b>01</b>
                <span>
                  같은 주가 아니라 언급 주 t와 이후 t+{horizon}주 수익률을
                  비교합니다.
                </span>
              </li>
              <li>
                <b>02</b>
                <span>
                  결측 가격은 보간하지 않으며 해당 관측을 계산에서 제외합니다.
                </span>
              </li>
              <li>
                <b>03</b>
                <span>
                  상관은 인과가 아닙니다. 탐색용 지표로만 해석해야 합니다.
                </span>
              </li>
            </ul>
          </aside>
        </section>

        <footer className="footer">
          <p>
            가격: {snapshot.collection.price.source}
            <br />
            언급량: 네이버·다음 카페 공개 검색 · Asia/Seoul · 월요일 시작
          </p>
          <p>
            과거 확정 주는 보존하고 최근 구간만 증분 갱신합니다.
            <br />
            {snapshot.meta.note}
          </p>
        </footer>
      </main>
    </div>
  );
}
