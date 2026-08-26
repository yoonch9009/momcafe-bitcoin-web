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
  ShieldAlert,
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
  highZoneSpikeAnalysis,
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

const rangeOptions = [
  { value: "1y", label: "최근 1년", shortLabel: "1Y", weeks: 52 },
  { value: "3y", label: "최근 3년", shortLabel: "3Y", weeks: 156 },
  { value: "5y", label: "최근 5년", shortLabel: "5Y", weeks: 260 },
  { value: "7y", label: "최근 7년", shortLabel: "7Y", weeks: 364 },
  { value: "10y", label: "최근 10년", shortLabel: "10Y", weeks: 520 },
  {
    value: "all",
    label: "전체 기간",
    shortLabel: "전체",
    weeks: Number.POSITIVE_INFINITY,
  },
] as const;

type Range = (typeof rangeOptions)[number]["value"];
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
  return rangeOptions.find((option) => option.value === range)!.weeks;
}

function rangeShortLabel(range: Range) {
  return rangeOptions.find((option) => option.value === range)!.shortLabel;
}

function fixed(value: number | null, digits = 2, suffix = "") {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function signed(value: number | null, digits = 2, suffix = "%") {
  return value === null
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function signedCount(value: number | null) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value}건`;
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
                      ? point.attentionPercentile
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
    () =>
      scatter.map(
        (point) => [point.attentionPercentile, point.returnPct] as const,
      ),
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
  const highZoneSpike = useMemo(
    () => highZoneSpikeAnalysis(analytics),
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
  const latestAttention = [...analytics]
    .reverse()
    .find(
      (point) =>
        point.periodStatus === "complete" && point.attentionPercentile !== null,
    )!;
  const latestAttentionIndex = analytics.indexOf(latestAttention);
  const attentionFourWeeksAgo = analytics[latestAttentionIndex - 4];
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
              저빈도 언급량의 경험적 백분위, 거래량·변동성, ±8주 선행성, 비모수
              급증 이벤트와 표본외 검증을 같은 주간 축에서 확인합니다.
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
              <span>관심도 위치</span>
              <span className="kpi-icon">
                <Activity size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {fixed(latestAttention.attentionPercentile, 0, "백분위")}
            </div>
            <div className="kpi-foot">
              <span>{latestAttention.week} · 이전 52주 내 동률 중간순위</span>
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>언급량 4주 변화</span>
              <span className="kpi-icon">
                <Hash size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {signedCount(latestAttention.mentionChange4w)}
            </div>
            <div className="kpi-foot">
              <CalendarClock size={13} />
              <span>
                현재 {latestAttention.postCount}건 · 4주 전{" "}
                {attentionFourWeeksAgo?.postCount ?? "—"}건
              </span>
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

        <section
          className={`surface high-zone-section ${highZoneSpike.latest?.isActive ? "is-active" : ""}`}
          aria-labelledby="high-zone-title"
        >
          <div className="section-head high-zone-head">
            <div>
              <p className="eyebrow">HIGH-ZONE ATTENTION ALERT</p>
              <h2 id="high-zone-title">고점권 초대형 언급 경보</h2>
              <p className="section-note">
                직전 26주 고점의 90% 이상에서, 최근 52주 중앙값보다 10건 이상
                많고 동시에 5배 이상일 때 발생합니다. 완결 주만 사용해 미래 정보
                없이 판정합니다.
              </p>
            </div>
            <div
              className={`high-zone-status ${highZoneSpike.latest?.isActive ? "active" : "inactive"}`}
            >
              <ShieldAlert aria-hidden="true" size={18} />
              <span>
                {highZoneSpike.latest?.isActive
                  ? "추격 매수 금지"
                  : "현재 경보 없음"}
              </span>
            </div>
          </div>

          {highZoneSpike.latest ? (
            <div className="high-zone-current">
              <div className="high-zone-current-title">
                <span>최근 완결 주</span>
                <strong>{highZoneSpike.latest.week}</strong>
              </div>
              <div className="high-zone-readings">
                <div>
                  <span>언급량</span>
                  <strong>
                    {integer.format(highZoneSpike.latest.postCount)}건
                  </strong>
                </div>
                <div>
                  <span>52주 중앙값</span>
                  <strong>
                    {fixed(highZoneSpike.latest.baselineMedian, 1, "건")}
                  </strong>
                </div>
                <div>
                  <span>중앙값 대비</span>
                  <strong>
                    {fixed(highZoneSpike.latest.mentionMultiple, 1, "배")}
                  </strong>
                </div>
                <div>
                  <span>26주 고점 대비</span>
                  <strong>
                    {signed(highZoneSpike.latest.priceToPriorHighPct, 1)}
                  </strong>
                </div>
                <div>
                  <span>현재 필요 언급량</span>
                  <strong>{highZoneSpike.latest.requiredCount}건 이상</strong>
                </div>
              </div>
            </div>
          ) : null}

          <div
            className="high-zone-summary"
            aria-label="대표 고점 기준 역사적 결과"
          >
            <article>
              <span>과거 독립 사건</span>
              <strong>
                {highZoneSpike.representativePeakSummary.events}
                <small>회</small>
              </strong>
              <p>2주 이내 연속 신호는 하나의 에피소드로 묶음</p>
            </article>
            <article>
              <span>4주 내 -10% 하락 경험</span>
              <strong>
                {fixed(
                  highZoneSpike.representativePeakSummary.drawdown10Rate4wPct,
                  1,
                  "%",
                )}
              </strong>
              <p>
                최대 낙폭 중앙값{" "}
                {signed(
                  highZoneSpike.representativePeakSummary.medianDrawdown4wPct,
                  1,
                )}
              </p>
            </article>
            <article>
              <span>12주 종가 하락 비율</span>
              <strong>
                {fixed(
                  highZoneSpike.representativePeakSummary.negativeReturn12wPct,
                  1,
                  "%",
                )}
              </strong>
              <p>
                12주 수익률 중앙값{" "}
                {signed(
                  highZoneSpike.representativePeakSummary.medianReturn12wPct,
                  1,
                )}
              </p>
            </article>
            <article>
              <span>최초 경보 후 12주 최대 상승</span>
              <strong>
                {signed(
                  highZoneSpike.firstTriggerSummary.medianUpside12wPct,
                  1,
                )}
              </strong>
              <p>고점의 끝은 알 수 없으므로 즉시 숏 신호로 사용하지 않음</p>
            </article>
          </div>

          <div className="high-zone-interpretation">
            <strong>운용 해석</strong>
            <p>
              이 경보는 하락 방향을 맞히는 매매 신호가 아니라, 신규 매수·불타기·
              피라미딩을 멈추고 기존 비중과 손실 허용 범위를 재점검하는 위험관리
              신호입니다. “대표 고점” 성과는 에피소드가 끝난 뒤 확인되는 설명용
              통계이며 실시간 진입점이 아닙니다.
            </p>
          </div>

          <div className="table-scroll high-zone-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>대표 고점 주</th>
                  <th>언급</th>
                  <th>중앙값</th>
                  <th>배수</th>
                  <th>26주 고점 대비</th>
                  <th>4주 수익률</th>
                  <th>4주 최대낙폭</th>
                  <th>12주 수익률</th>
                  <th>12주 최대낙폭</th>
                </tr>
              </thead>
              <tbody>
                {highZoneSpike.episodes.map(({ representativePeak }) => (
                  <tr key={representativePeak.week}>
                    <td>{representativePeak.week}</td>
                    <td>{representativePeak.postCount}건</td>
                    <td>{fixed(representativePeak.baselineMedian, 1)}</td>
                    <td>{fixed(representativePeak.mentionMultiple, 1, "×")}</td>
                    <td>{signed(representativePeak.priceToPriorHighPct, 1)}</td>
                    <td>{signed(representativePeak.return4wPct, 1)}</td>
                    <td>{signed(representativePeak.maxDrawdown4wPct, 1)}</td>
                    <td>{signed(representativePeak.return12wPct, 1)}</td>
                    <td>{signed(representativePeak.maxDrawdown12wPct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface chart-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">MULTI-SIGNAL TIMELINE</p>
              <h2>언급량과 시장 반응</h2>
              <p className="section-note">
                막대는 주간 언급량, 선은 선택 지표입니다. 현재 주의 언급량,
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
                <option value="attention">관심도 백분위</option>
                <option value="nextReturn">다음 주 수익률</option>
              </select>
              <select
                aria-label="조회 기간"
                className="select-control"
                onChange={(event) => setRange(event.target.value as Range)}
                value={range}
              >
                {rangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
                <h2>상대 관심도와 이후 수익률</h2>
                <p className="section-note">
                  x축은 언급 주 t의 이전 52주 대비 경험적 백분위, y축은 t에서 t+
                  {horizon}주까지의 수익률입니다. 현재 주와 초기 기준기간은
                  제외합니다.
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
            <h2 className="mt-2 text-xl font-semibold">백분위·순위 상관</h2>
            <div className="dual-stat">
              <div>
                <span>Pearson (백분위)</span>
                <strong>{fixed(correlation, 3)}</strong>
              </div>
              <div>
                <span>Spearman</span>
                <strong>{fixed(rankCorrelation, 3)}</strong>
              </div>
            </div>
            <p className="sample-note">
              n = {scatter.length} · {rangeShortLabel(range)}
            </p>
            <ul className="method-list">
              <li>
                <b>01</b>
                <span>
                  경험적 백분위는 0건과 동률을 보존하면서 극단값 영향을
                  제한합니다.
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
                양수(+N)는 관심도 백분위가 시장 지표보다 N주 먼저, 음수(-N)는
                시장 지표가 먼저입니다. 각 칸은 선택한 상관계수입니다.
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
              이전 52주 상위 5%이면서 중앙값보다 3건 이상 많은 주를 사건으로
              잡아 이후 중앙 수익률과 최대 유리·불리 움직임을 계산합니다.
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
                          : "n<8"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny-note">
              각 지평에서 겹치는 사건 구간은 제거합니다. 95% 구간은 n≥8일 때만
              이동 블록 부트스트랩 중앙값 구간으로 표시합니다.
            </p>
          </article>
        </section>

        <section className="analysis-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">TIME-VARYING RELATIONSHIP</p>
            <h2 className="mt-2 text-xl font-semibold">52주 롤링 상관</h2>
            <p className="section-note">
              관심도 백분위(t)와 다음 1주 수익률(t+1)의 관계가 시간에 따라
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
              관심도는 52주 경험적 백분위를 사용합니다. 추세는 26주 이동평균,
              변동성은 이전 52주 중앙값으로만 판정합니다.
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
              {granger.observations}. log1p 변환은 0건을 처리하지만 카운트의
              과산포를 직접 모형화하지 않으므로 탐색적 보조지표이며, 경제적
              인과의 증명이 아닙니다.
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
                원시 언급량, 52주 경험적 백분위, 절대 건수 변화, OHLCV, 비중첩
                이벤트, 선행·후행, 체제, Granger, 워크포워드
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
                언급량은 0이 많고 과산포된 이산값입니다. 헤드라인은 확정 주만
                사용하며 상관·선행성은 매매성과나 인과를 보장하지 않음
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
