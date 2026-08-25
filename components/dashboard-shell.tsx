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
import {
  enrichSeries,
  eventStudy,
  laggedReturns,
  leadLagMatrix,
  pearson,
  regimeAnalysis,
  relativeChange,
  rollingCorrelations,
  spearman,
  walkForwardValidation,
  type LeadLagOutcome,
} from "@/lib/statistics";

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
const RollingCorrelationChart = dynamic(
  () =>
    import("@/components/dashboard-charts").then(
      (module) => module.RollingCorrelationChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
const EventStudyChart = dynamic(
  () =>
    import("@/components/dashboard-charts").then(
      (module) => module.EventStudyChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

type Range = "1y" | "3y" | "all";
type HeatMethod = "pearson" | "spearman";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("ko-KR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const outcomeNames: Record<LeadLagOutcome, string> = {
  return: "수익률",
  absoluteReturn: "절대수익률",
  volumeChange: "거래량 변화",
  volatility: "실현변동성",
  range: "고저 변동폭",
};

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

function fixed(value: number | null, digits = 2, suffix = "") {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function signed(value: number | null, digits = 2, suffix = "%") {
  return value === null
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function heatBackground(value: number | null) {
  if (value === null) return "var(--canvas-soft)";
  const opacity = 0.12 + Math.min(1, Math.abs(value)) * 0.7;
  return value >= 0
    ? `color-mix(in srgb, var(--green) ${opacity * 100}%, var(--canvas-soft))`
    : `color-mix(in srgb, var(--red) ${opacity * 100}%, var(--canvas-soft))`;
}

export function DashboardShell() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("close");
  const [range, setRange] = useState<Range>("3y");
  const [horizon, setHorizon] = useState(1);
  const [logarithmic, setLogarithmic] = useState(false);
  const [heatMethod, setHeatMethod] = useState<HeatMethod>("spearman");
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

  const analytics = useMemo(
    () => (snapshot ? enrichSeries(snapshot.series) : []),
    [snapshot],
  );
  const visibleSeries = useMemo(() => {
    const length = rangeLength(range);
    return Number.isFinite(length) ? analytics.slice(-length) : analytics;
  }, [analytics, range]);
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
              : metric === "volume"
                ? point.btcVolume
                : metric === "volatility"
                  ? point.realizedVolatility
                  : metric === "range"
                    ? point.rangePct
                    : metric === "attention"
                      ? point.attentionScore
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
  const correlationPairs = useMemo(
    () => scatter.map((point) => [point.posts, point.returnPct] as const),
    [scatter],
  );
  const correlation = useMemo(
    () => pearson(correlationPairs),
    [correlationPairs],
  );
  const rankCorrelation = useMemo(
    () => spearman(correlationPairs),
    [correlationPairs],
  );
  const heatmap = useMemo(() => leadLagMatrix(visibleSeries), [visibleSeries]);
  const events = useMemo(() => eventStudy(visibleSeries), [visibleSeries]);
  const regimes = useMemo(() => regimeAnalysis(visibleSeries), [visibleSeries]);
  const rolling = useMemo(() => {
    const output = rollingCorrelations(analytics);
    const length = rangeLength(range);
    return Number.isFinite(length) ? output.slice(-length) : output;
  }, [analytics, range]);
  const walkForward = useMemo(
    () => walkForwardValidation(analytics),
    [analytics],
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

  if (!snapshot || !analytics.length) {
    return (
      <main className="loading-grid min-h-screen">
        <div className="loading-copy">
          <div className="loading-mark" />
          <p className="eyebrow">LOADING SIGNALS</p>
        </div>
      </main>
    );
  }

  const latest = [...analytics]
    .reverse()
    .find((point) => point.btcClose !== null)!;
  const previous = [...analytics]
    .slice(0, analytics.indexOf(latest))
    .reverse()
    .find((point) => point.btcClose !== null);
  const priceChange = relativeChange(
    latest.btcClose,
    previous?.btcClose ?? null,
  );
  const postStatus = snapshot.collection.posts.status;
  const isLive = latest.periodStatus === "in_progress";
  const logEligible = ["close", "mean", "volume"].includes(metric);
  const granger = snapshot.analysis.granger;
  const significantGranger =
    granger.status === "ok"
      ? granger.tests.filter((test) => test.qValue < 0.05).length
      : 0;

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
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span className="sr-only">테마 전환</span>
          </button>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div>
            <p className="eyebrow">ATTENTION × MARKET MICROSTRUCTURE</p>
            <h1>
              대화의 파동과
              <br />
              <em>비트코인의 반응.</em>
            </h1>
            <p className="hero-copy">
              단순 상관을 넘어 관심도 서프라이즈, 거래량·변동성, ±8주 선행성,
              급증 이벤트, 시장 체제와 시계열 검정까지 같은 주간 축에서
              확인합니다.
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
              <span>OHLCV 커버리지</span>
              <strong className="status-value">
                {snapshot.collection.price.ohlcvCoverage}/
                {snapshot.series.length}주
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
              <span>과거값 정책</span>
              <strong className="status-value">IMMUTABLE</strong>
            </div>
          </aside>
        </section>

        <section className="kpi-grid kpi-grid-wide" aria-label="핵심 지표">
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>BTC-USD 최신 관측</span>
              <span className="kpi-icon">
                <TrendingUp size={16} />
              </span>
            </div>
            <div className="kpi-value">{usd.format(latest.btcClose!)}</div>
            <div className="kpi-foot">
              {priceChange !== null && priceChange >= 0 ? (
                <ArrowUpRight className="trend-up" size={14} />
              ) : (
                <ArrowDownRight className="trend-down" size={14} />
              )}
              <span
                className={
                  priceChange !== null && priceChange >= 0
                    ? "trend-up"
                    : "trend-down"
                }
              >
                {signed(priceChange)}
              </span>
              <span>전주 대비</span>
              {isLive ? <span className="live-pill">LIVE WEEK</span> : null}
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>관심도 서프라이즈</span>
              <span className="kpi-icon">
                <Activity size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {fixed(latest.attentionScore, 2, "σ")}
            </div>
            <div className="kpi-foot">
              <span>이전 52주 log 언급량의 중앙값·MAD 기준</span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>언급량 4주 모멘텀</span>
              <span className="kpi-icon">
                <Hash size={16} />
              </span>
            </div>
            <div className="kpi-value">{signed(latest.mentionMomentum4w)}</div>
            <div className="kpi-foot">
              <CalendarClock size={13} />
              <span>0건도 계산 가능한 +1 보정</span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>주간 실현변동성</span>
              <span className="kpi-icon">
                <BarChart3 size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {fixed(latest.realizedVolatility, 2, "%")}
            </div>
            <div className="kpi-foot">
              <span>일별 로그수익률 제곱합의 제곱근</span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>거래량</span>
              <span className="kpi-icon">
                <Activity size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {latest.btcVolume === null
                ? "—"
                : compact.format(latest.btcVolume)}
            </div>
            <div className="kpi-foot">
              <span>Coinbase BTC · 현재 주 누적</span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>마지막 갱신</span>
              <span className="kpi-icon">
                <RefreshCw size={16} />
              </span>
            </div>
            <div className="kpi-value kpi-date">
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
              <p className="eyebrow">MULTI-SIGNAL TIMELINE</p>
              <h2>언급량과 시장 반응</h2>
              <p className="section-note">
                막대는 주간 언급량, 선은 선택 지표입니다. 현재 주의
                가격·거래량은 마감값이 아닌 누적 관측치입니다.
              </p>
            </div>
            <div className="control-row">
              <select
                aria-label="시장 지표"
                className="select-control"
                onChange={(event) => {
                  const next = event.target.value as Metric;
                  setMetric(next);
                  if (!["close", "mean", "volume"].includes(next))
                    setLogarithmic(false);
                }}
                value={metric}
              >
                <option value="close">주간 종가</option>
                <option value="mean">주간 평균</option>
                <option value="volume">거래량</option>
                <option value="volatility">실현변동성</option>
                <option value="range">고저 변동폭</option>
                <option value="attention">관심도 서프라이즈</option>
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
                disabled={!logEligible}
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
                <p className="eyebrow">FORWARD RETURN</p>
                <h2>언급량과 이후 수익률</h2>
                <p className="section-note">
                  x축은 언급 주 t, y축은 t에서 t+{horizon}주까지의 수익률입니다.
                  미래 가격이 없는 관측은 제외합니다.
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
            <p className="eyebrow">CORRELATION CHECK</p>
            <h2 className="mt-2 text-xl font-semibold">선형·순위 상관</h2>
            <div className="dual-stat">
              <div>
                <span>Pearson</span>
                <strong>{fixed(correlation, 3)}</strong>
              </div>
              <div>
                <span>Spearman</span>
                <strong>{fixed(rankCorrelation, 3)}</strong>
              </div>
            </div>
            <p className="sample-note">
              n = {scatter.length} ·{" "}
              {range === "all" ? "전체" : range.toUpperCase()}
            </p>
            <ul className="method-list">
              <li>
                <b>01</b>
                <span>
                  Spearman은 극단값과 비선형 단조관계에 더 견고합니다.
                </span>
              </li>
              <li>
                <b>02</b>
                <span>
                  기간·지평 선택에 따라 계수가 달라지는지 함께 봅니다.
                </span>
              </li>
              <li>
                <b>03</b>
                <span>상관은 인과나 매매 수익성을 증명하지 않습니다.</span>
              </li>
            </ul>
          </aside>
        </section>

        <section className="surface chart-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">±8 WEEK LEAD / LAG</p>
              <h2>무엇이 먼저 움직였나</h2>
              <p className="section-note">
                양수(+N)는 관심도 서프라이즈가 시장 지표보다 N주 먼저,
                음수(-N)는 시장 지표가 먼저입니다. 각 칸은 선택한
                상관계수입니다.
              </p>
            </div>
            <select
              aria-label="히트맵 상관 방식"
              className="select-control"
              onChange={(event) =>
                setHeatMethod(event.target.value as HeatMethod)
              }
              value={heatMethod}
            >
              <option value="spearman">Spearman</option>
              <option value="pearson">Pearson</option>
            </select>
          </div>
          <div className="heatmap-scroll">
            <div
              className="heatmap"
              role="table"
              aria-label="선행 후행 상관 히트맵"
            >
              <div className="heat-label heat-head">지표 / 시차</div>
              {Array.from({ length: 17 }, (_, index) => index - 8).map(
                (lag) => (
                  <div className="heat-head" key={lag}>
                    {lag > 0 ? `+${lag}` : lag}
                  </div>
                ),
              )}
              {(Object.keys(outcomeNames) as LeadLagOutcome[]).map(
                (outcome) => (
                  <div className="heat-row" key={outcome}>
                    <div className="heat-label">{outcomeNames[outcome]}</div>
                    {heatmap
                      .filter((cell) => cell.outcome === outcome)
                      .map((cell) => {
                        const value = cell[heatMethod];
                        return (
                          <div
                            className="heat-cell"
                            key={cell.lag}
                            style={{ background: heatBackground(value) }}
                            title={`${outcomeNames[outcome]} · ${cell.lag > 0 ? "+" : ""}${cell.lag}주 · ${heatMethod}=${fixed(value, 3)} · n=${cell.observations}`}
                          >
                            {fixed(value, 2)}
                          </div>
                        );
                      })}
                  </div>
                ),
              )}
            </div>
          </div>
          <div className="heat-legend">
            <span>가격 선행 ←</span>
            <i />
            <span>→ 관심도 선행</span>
          </div>
        </section>

        <section className="analysis-grid event-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">SPIKE EVENT STUDY</p>
            <h2 className="mt-2 text-xl font-semibold">관심 급증 이후 경로</h2>
            <p className="section-note">
              관심도 서프라이즈가 +2σ 이상인 주를 사건으로 잡아 이후 중앙
              수익률과 최대 유리·불리 움직임을 Coinbase OHLCV 기준으로
              계산합니다.
            </p>
            <div className="chart-wrap">
              <EventStudyChart data={events} />
            </div>
          </article>
          <article className="surface analysis-card table-card">
            <p className="eyebrow">ROBUST OUTCOMES</p>
            <h2 className="mt-2 text-xl font-semibold">사건별 결과</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>지평</th>
                    <th>n</th>
                    <th>중앙수익</th>
                    <th>상승률</th>
                    <th>MFE</th>
                    <th>MAE</th>
                    <th>95% CI</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((item) => (
                    <tr key={item.horizon}>
                      <td>+{item.horizon}주</td>
                      <td>{item.events}</td>
                      <td>{signed(item.medianReturnPct)}</td>
                      <td>{fixed(item.hitRatePct, 1, "%")}</td>
                      <td>{signed(item.medianMfePct)}</td>
                      <td>{signed(item.medianMaePct)}</td>
                      <td>
                        {item.confidenceInterval
                          ? `${signed(item.confidenceInterval[0], 1)} ~ ${signed(item.confidenceInterval[1], 1)}`
                          : "n<5"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny-note">
              95% 구간은 시계열 의존을 일부 보존하는 이동 블록 부트스트랩 중앙값
              구간입니다. 사건 중첩은 제거하지 않았습니다.
            </p>
          </article>
        </section>

        <section className="analysis-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">TIME-VARYING RELATIONSHIP</p>
            <h2 className="mt-2 text-xl font-semibold">52주 롤링 상관</h2>
            <p className="section-note">
              관심도 서프라이즈(t)와 다음 1주 수익률(t+1)의 관계가 시간에 따라
              얼마나 불안정한지 보여줍니다.
            </p>
            <div className="chart-wrap">
              <RollingCorrelationChart data={rolling} />
            </div>
          </article>
          <article className="surface analysis-card table-card">
            <p className="eyebrow">MARKET REGIMES</p>
            <h2 className="mt-2 text-xl font-semibold">시장 체제별 차이</h2>
            <p className="section-note">
              추세는 26주 이동평균, 변동성은 이전 52주 중앙값으로만 판정합니다.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>체제</th>
                    <th>n</th>
                    <th>Pearson</th>
                    <th>Spearman</th>
                    <th>다음주 중앙수익</th>
                  </tr>
                </thead>
                <tbody>
                  {regimes.map((item) => (
                    <tr key={item.regime}>
                      <td>{item.regime}</td>
                      <td>{item.observations}</td>
                      <td>{fixed(item.pearson, 3)}</td>
                      <td>{fixed(item.spearman, 3)}</td>
                      <td>{signed(item.medianNextReturnPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="analysis-grid diagnostics-grid">
          <article className="surface analysis-card table-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">GRANGER PRECEDENCE</p>
                <h2>양방향 시계열 검정</h2>
                <p className="section-note">
                  비정상 수준값 대신 Δlog(1+언급량)과 BTC 로그수익률을 사용하며,
                  양방향 1–4주 전체에 Benjamini–Hochberg FDR을 적용합니다.
                </p>
              </div>
              <span
                className={`result-pill ${significantGranger ? "signal" : ""}`}
              >
                q&lt;0.05 · {significantGranger}건
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>방향</th>
                    <th>시차</th>
                    <th>F</th>
                    <th>p</th>
                    <th>FDR q</th>
                    <th>판정</th>
                  </tr>
                </thead>
                <tbody>
                  {granger.tests.map((test) => (
                    <tr key={`${test.direction}-${test.lag}`}>
                      <td>
                        {test.direction === "attention_to_return"
                          ? "관심 → 수익률"
                          : "수익률 → 관심"}
                      </td>
                      <td>{test.lag}주</td>
                      <td>{test.fStatistic.toFixed(3)}</td>
                      <td>{test.pValue.toFixed(3)}</td>
                      <td>{test.qValue.toFixed(3)}</td>
                      <td>{test.qValue < 0.05 ? "유의" : "비유의"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny-note">
              ADF p: 관심 변화{" "}
              {fixed(granger.adfPValues?.attentionChange ?? null, 4)} · 수익률{" "}
              {fixed(granger.adfPValues?.btcReturn ?? null, 4)} · n=
              {granger.observations}. Granger 선행성은 경제적 인과의 증명이
              아닙니다.
            </p>
          </article>
          <aside className="surface analysis-card validation-card">
            <p className="eyebrow">WALK-FORWARD CHECK</p>
            <h2 className="mt-2 text-xl font-semibold">표본외 예측 검증</h2>
            <div className="validation-stat">
              <span>OOS R²</span>
              <strong>{fixed(walkForward.oosR2, 3)}</strong>
            </div>
            <div className="validation-stat">
              <span>방향 적중률</span>
              <strong>
                {fixed(walkForward.directionalAccuracyPct, 1, "%")}
              </strong>
            </div>
            <div className="validation-stat">
              <span>검증 표본</span>
              <strong>{integer.format(walkForward.observations)}</strong>
            </div>
            <p className="tiny-note">
              최초 104개 관측 이후 매주 이전 데이터로만 단순 선형모형을 다시
              적합합니다. OOS R²가 0 이하면 과거 평균보다 낫지 않습니다.
            </p>
          </aside>
        </section>

        <section className="surface availability">
          <div>
            <p className="eyebrow">DATA BOUNDARY</p>
            <h2>가능한 분석과 불가능한 추정의 경계</h2>
          </div>
          <div className="availability-grid">
            <article>
              <strong>현재 제공</strong>
              <p>
                언급량, 강건한 관심도, OHLCV, 변동성, 선행·후행, 이벤트, 롤링,
                체제, Granger, 워크포워드
              </p>
            </article>
            <article>
              <strong>현재 제공 불가</strong>
              <p>
                과거 게시글 원문이 필요한 감성·주제, 과거 카페별 수치가 필요한
                확산도·집중도
              </p>
            </article>
            <article>
              <strong>해석 원칙</strong>
              <p>
                진행 중인 주는 부분 관측이며, 상관·선행성·표본내 유의성은
                매매성과나 인과를 보장하지 않음
              </p>
            </article>
          </div>
        </section>

        <footer className="footer">
          <p>
            가격·OHLCV: {snapshot.collection.price.source}
            <br />
            언급량: 네이버·다음 카페 공개 검색 · Asia/Seoul · 월요일 시작
          </p>
          <p>
            과거 확정 종가·언급량은 보존하고 최근 2주만 증분 갱신합니다.
            <br />
            {snapshot.meta.note}
          </p>
        </footer>
      </main>
    </div>
  );
}
