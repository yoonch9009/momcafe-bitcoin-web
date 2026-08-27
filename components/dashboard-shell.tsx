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

import type {
  AlertPathPoint,
  Metric,
  TimelinePoint,
} from "@/components/dashboard-charts";
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
  pearson,
  regimeAnalysis,
  relativeChange,
  rollingCorrelations,
  spearman,
  walkForwardValidation,
} from "@/lib/statistics";

const TimelineChart = dynamic(
  () =>
    import("@/components/dashboard-charts").then(
      (module) => module.TimelineChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
const AlertPathChart = dynamic(
  () =>
    import("@/components/dashboard-charts").then(
      (module) => module.AlertPathChart,
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
  { value: "1y", label: "최근 1년", weeks: 52 },
  { value: "3y", label: "최근 3년", weeks: 156 },
  { value: "5y", label: "최근 5년", weeks: 260 },
  { value: "7y", label: "최근 7년", weeks: 364 },
  { value: "10y", label: "최근 10년", weeks: 520 },
  {
    value: "all",
    label: "전체 기간",
    weeks: Number.POSITIVE_INFINITY,
  },
] as const;

type Range = (typeof rangeOptions)[number]["value"];

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

export function DashboardShell() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("close");
  const [range, setRange] = useState<Range>("5y");
  const [horizon, setHorizon] = useState(12);
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

  const analytics = useMemo(
    () => (snapshot ? enrichSeries(snapshot.series) : []),
    [snapshot],
  );
  const highZoneSpike = useMemo(
    () => highZoneSpikeAnalysis(analytics),
    [analytics],
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
  const alertPath = useMemo<AlertPathPoint[]>(
    () =>
      highZoneSpike.horizonComparison.map((item) => ({
        horizon: item.horizon,
        firstTriggerMedianReturnPct: item.firstTrigger.medianReturnPct,
        representativePeakMedianReturnPct:
          item.representativePeak.medianReturnPct,
      })),
    [highZoneSpike],
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
  const broadSpikeEvents = useMemo(
    () => eventStudy(visibleSeries, [1, 2, 4, 8, 12]),
    [visibleSeries],
  );
  const rolling = useMemo(() => {
    const output = rollingCorrelations(analytics);
    const length = rangeLength(range);
    return Number.isFinite(length) ? output.slice(-length) : output;
  }, [analytics, range]);
  const regimes = useMemo(() => regimeAnalysis(visibleSeries), [visibleSeries]);
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
          <p className="eyebrow mt-5">데이터 형식 오류</p>
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
          <p className="eyebrow">데이터 불러오는 중</p>
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
  const ordinaryHighZone = highZoneSpike.benchmark12w.find(
    (item) => item.key === "ordinary_high_zone",
  )!;
  const relaxedSensitivity = highZoneSpike.sensitivity.find(
    (item) => item.absoluteIncrease === 5 && item.ratioIncrease === 5,
  )!;
  const selectedRangeLabel = rangeOptions.find(
    (option) => option.value === range,
  )!.label;
  const granger = snapshot.analysis.granger;
  const significantPrecedence = granger.tests.filter(
    (test) => test.qValue < 0.05,
  ).length;

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
            <strong>비트코인 × 맘카페</strong>
            <span>고점권 언급 경보 대시보드</span>
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
            <p className="eyebrow">맘카페 언급량으로 보는 과열 위험</p>
            <h1>
              맘카페 언급 급증과
              <br />
              <em>비트코인 고점 위험.</em>
            </h1>
            <p className="hero-copy">
              평소 0~1건인 저빈도 언급량의 특성을 반영해 이전 52주 중앙값과
              비교합니다. 비트코인 고점권에서 언급량이 이례적으로 급증한 뒤의
              가격 경로를 확인하고 추격 매수 위험을 점검합니다.
            </p>
          </div>
          <aside className="status-panel" aria-label="데이터 상태">
            <div className="status-row">
              <span>가격 수집 기준일</span>
              <strong className="status-value">
                {snapshot.collection.price.observedThrough}
              </strong>
            </div>
            <div className="status-row">
              <span>주간 가격 데이터</span>
              <strong className="status-value">
                {snapshot.collection.price.ohlcvCoverage}/
                {snapshot.series.length}주
              </strong>
            </div>
            <div className="status-row">
              <span>카페 수집 상태</span>
              <strong className="status-value">
                <i className={`status-dot ${postStatus}`} />
                {postStatus === "ok" ? "정상" : "기존값 보존"}
              </strong>
            </div>
            <div className="status-row">
              <span>과거 확정값</span>
              <strong className="status-value">수정 없이 보존</strong>
            </div>
          </aside>
        </section>

        <section className="kpi-grid kpi-grid-wide" aria-label="핵심 지표">
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>비트코인 최근 종가</span>
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
              {isLive ? <span className="live-pill">진행 중인 주</span> : null}
            </div>
          </article>
          <article className="surface kpi-card">
            <div className="kpi-head">
              <span>관심도 백분위</span>
              <span className="kpi-icon">
                <Activity size={16} />
              </span>
            </div>
            <div className="kpi-value">
              {fixed(latestAttention.attentionPercentile, 0, " 백분위")}
            </div>
            <div className="kpi-foot">
              <span>{latestAttention.week} · 이전 52주 내 언급량 순위</span>
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
              <span>일별 로그수익률 기준</span>
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

        <section className="surface chart-section primary-timeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">가격과 언급량 한눈에 보기</p>
              <h2>비트코인 종가와 맘카페 언급량</h2>
              <p className="section-note">
                막대는 한 주 동안 수집된 맘카페 언급 건수, 선은 선택한 비트코인
                지표입니다. 주황색 세로선은 각 경보 구간에서 언급량이 가장
                많았던 주이며, 사건이 끝난 뒤 확인되는 참고 표시입니다.
              </p>
            </div>
            <div className="control-row">
              <select
                aria-label="언급량과 함께 볼 비트코인 지표"
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
                <option value="mean">주간 평균가</option>
                <option value="volume">주간 거래량</option>
                <option value="volatility">주간 실현변동성</option>
                <option value="range">주간 고저 변동폭</option>
                <option value="attention">관심도 백분위</option>
                <option value="nextReturn">다음 주 수익률</option>
              </select>
              <select
                aria-label="차트 조회 기간"
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
                title="가격과 거래량을 로그 스케일로 표시합니다"
                type="button"
              >
                <BarChart3 size={14} /> 로그 축
              </button>
            </div>
          </div>
          <div className="chart-wrap">
            <TimelineChart
              alertWeeks={highZoneSpike.episodes.map(
                (episode) => episode.representativePeak.week,
              )}
              data={timeline}
              logarithmic={logarithmic}
              metric={metric}
            />
          </div>
          <p className="tiny-note">
            기본 조회 기간은 최근 5년입니다. 가장 오른쪽의 진행 중인 주는 아직
            마감되지 않은 누적값이므로 과거의 마감된 주와 직접 비교할 때
            주의하세요.
          </p>
        </section>

        <section
          className={`surface high-zone-section ${highZoneSpike.latest?.isActive ? "is-active" : ""}`}
          aria-labelledby="high-zone-title"
        >
          <div className="section-head high-zone-head">
            <div>
              <p className="eyebrow">현재 위험 신호</p>
              <h2 id="high-zone-title">고점권 초대형 언급 경보</h2>
              <p className="section-note">
                비트코인 종가가 직전 26주 최고 종가의 90% 이상인 상태에서,
                언급량이 이전 52주 중앙값보다 10건 이상 많고 동시에 5배 이상이면
                경보가 발생합니다. 마감된 주만 사용하므로 당시에도 알 수 있었던
                값으로 판정합니다.
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
                <span>최근 마감 주</span>
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
                  <span>52주 언급량 중앙값</span>
                  <strong>
                    {fixed(highZoneSpike.latest.baselineMedian, 1, "건")}
                  </strong>
                </div>
                <div>
                  <span>중앙값 대비 배수</span>
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
                  <span>경보 기준 언급량</span>
                  <strong>{highZoneSpike.latest.requiredCount}건 이상</strong>
                </div>
              </div>
            </div>
          ) : null}

          <div
            className="high-zone-summary"
            aria-label="언급량 정점 기준 과거 결과"
          >
            <article>
              <span>과거 독립 경보</span>
              <strong>
                {highZoneSpike.representativePeakSummary.events}
                <small>회</small>
              </strong>
              <p>2주 안에 이어진 경보는 같은 구간으로 묶음</p>
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
                4주 MAE 중앙값{" "}
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
              <span>실시간 첫 경보 후 12주 MFE</span>
              <strong>
                {signed(
                  highZoneSpike.firstTriggerSummary.medianUpside12wPct,
                  1,
                )}
              </strong>
              <p>고점의 끝은 알 수 없으므로 즉시 숏 진입에 사용하지 않음</p>
            </article>
          </div>

          <div className="high-zone-interpretation">
            <strong>이 경보를 실제로 쓰는 방법</strong>
            <p>
              이 경보는 하락 방향을 맞히는 매매 신호가 아닙니다. 신규 매수와
              수익 중인 포지션의 추가 매수(불타기)를 멈추고, 기존 비중과 손실
              허용 범위를 재점검하는 리스크 관리 신호입니다. “언급량 정점”은
              경보 구간이 끝난 뒤에야 확인되므로 실시간 매매 시점으로 사용할 수
              없습니다.
            </p>
          </div>

          <div className="table-scroll high-zone-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>언급량 정점 주(사후)</th>
                  <th>언급량</th>
                  <th>52주 중앙값</th>
                  <th>중앙값 대비</th>
                  <th>26주 고점 대비</th>
                  <th>4주 수익률</th>
                  <th>4주 MAE</th>
                  <th>12주 수익률</th>
                  <th>12주 MAE</th>
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

        <section className="analysis-grid alert-analysis-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">경보 시점과 사후 정점 비교</p>
            <h2 className="mt-2 text-xl font-semibold">
              실시간 첫 경보와 언급량 정점 이후 수익률
            </h2>
            <p className="section-note">
              7개 경보 구간의 수익률 중앙값입니다. “실시간 첫 경보”는 조건을
              처음 충족한 주라 당시에도 알 수 있습니다. “언급량 정점”은 같은
              경보 구간에서 언급량이 가장 많았던 주라 구간이 끝난 뒤에만 알 수
              있습니다. 가격의 정확한 고점을 뜻하지 않습니다.
            </p>
            <div className="chart-wrap">
              <AlertPathChart data={alertPath} />
            </div>
          </article>
          <aside className="surface analysis-card validation-card">
            <p className="eyebrow">숫자로 읽는 경보</p>
            <h2 className="mt-2 text-xl font-semibold">경보의 정확한 의미</h2>
            <div className="validation-stat">
              <span>실시간 첫 경보 후 4주 종가 하락</span>
              <strong>
                {fixed(
                  highZoneSpike.firstTriggerSummary.negativeReturn4wPct,
                  1,
                  "%",
                )}
              </strong>
            </div>
            <div className="validation-stat">
              <span>언급량 정점 후 4주 종가 하락</span>
              <strong>
                {fixed(
                  highZoneSpike.representativePeakSummary.negativeReturn4wPct,
                  1,
                  "%",
                )}
              </strong>
            </div>
            <div className="validation-stat">
              <span>실시간 첫 경보 후 12주 MFE</span>
              <strong>
                {signed(
                  highZoneSpike.firstTriggerSummary.medianUpside12wPct,
                  1,
                )}
              </strong>
            </div>
            <p className="tiny-note">
              실시간 첫 경보 직후 4주는 하락보다 상승 종가가 많았습니다. 따라서
              즉시 숏 진입할 시점이 아니라 추격 매수와 추가 매수를 멈추는
              시점으로 해석합니다.
            </p>
          </aside>
        </section>

        <section className="analysis-grid event-grid alert-tables-grid">
          <article className="surface analysis-card table-card">
            <p className="eyebrow">경보 후 기간별 가격 경로</p>
            <h2 className="mt-2 text-xl font-semibold">기간별 위험 경로</h2>
            <p className="section-note">
              같은 7개 경보 구간을 1·2·4·8·12주 뒤로 비교합니다. 수익률과
              MFE(최대 상승폭), MAE(최대 하락폭)를 함께 봅니다.
            </p>
            <div className="table-scroll">
              <table className="data-table alert-detail-table">
                <thead>
                  <tr>
                    <th>경과 기간</th>
                    <th>첫 경보 수익률</th>
                    <th>언급 정점 수익률</th>
                    <th>첫 경보 MAE</th>
                    <th>언급 정점 MAE</th>
                    <th>첫 경보 MFE</th>
                  </tr>
                </thead>
                <tbody>
                  {highZoneSpike.horizonComparison.map((item) => (
                    <tr key={item.horizon}>
                      <td>+{item.horizon}주</td>
                      <td>{signed(item.firstTrigger.medianReturnPct, 1)}</td>
                      <td>
                        {signed(item.representativePeak.medianReturnPct, 1)}
                      </td>
                      <td>{signed(item.firstTrigger.medianDrawdownPct, 1)}</td>
                      <td>
                        {signed(item.representativePeak.medianDrawdownPct, 1)}
                      </td>
                      <td>{signed(item.firstTrigger.medianUpsidePct, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          <article className="surface analysis-card table-card">
            <p className="eyebrow">비슷한 가격대와 비교</p>
            <h2 className="mt-2 text-xl font-semibold">
              평범한 고점권과 무엇이 다른가
            </h2>
            <p className="section-note">
              모두 직전 26주 고점의 90% 이상인 주입니다. 경보 주변 ±2주는 일반
              고점권 표본에서 제외했습니다.
            </p>
            <div className="table-scroll">
              <table className="data-table alert-detail-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>표본 수</th>
                    <th>12주 하락 비율</th>
                    <th>수익률 중앙값</th>
                    <th>-10% 이상 하락</th>
                    <th>MAE</th>
                    <th>MFE</th>
                  </tr>
                </thead>
                <tbody>
                  {highZoneSpike.benchmark12w.map((item) => (
                    <tr
                      className={
                        item.key === "first_trigger" ? "selected-row" : ""
                      }
                      key={item.key}
                    >
                      <td>{item.label}</td>
                      <td>{item.observations}</td>
                      <td>{fixed(item.negativeReturnPct, 1, "%")}</td>
                      <td>{signed(item.medianReturnPct, 1)}</td>
                      <td>{fixed(item.drawdown10RatePct, 1, "%")}</td>
                      <td>{signed(item.medianDrawdownPct, 1)}</td>
                      <td>{signed(item.medianUpsidePct, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny-note">
              언급 급증이 없었던 일반 고점권은 서로 겹치는 주간 자료입니다.
              독립된 경보 7개와 같은 통계 표본으로 보지 않고 방향과 크기를
              비교하는 참고값으로만 사용합니다.
            </p>
          </article>
        </section>

        <section className="surface chart-section sensitivity-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">경보 기준 점검</p>
              <h2>기준을 바꿔도 결론이 유지되는가</h2>
              <p className="section-note">
                고점권 90% 조건은 고정하고 절대 증가와 중앙값 배수를
                조합했습니다. 주황색 행이 현재 채택한 +10건·5배 기준입니다.
              </p>
            </div>
            <span className="result-pill signal">선택 기준 · +10건 / 5배</span>
          </div>
          <div className="table-scroll">
            <table className="data-table sensitivity-table">
              <thead>
                <tr>
                  <th>절대 증가 기준</th>
                  <th>배수 기준</th>
                  <th>사건 수</th>
                  <th>12주 하락 비율</th>
                  <th>12주 수익률 중앙값</th>
                  <th>-10% 이상 하락</th>
                  <th>12주 MAE 중앙값</th>
                </tr>
              </thead>
              <tbody>
                {highZoneSpike.sensitivity.map((item) => (
                  <tr
                    className={item.selected ? "selected-row" : ""}
                    key={`${item.absoluteIncrease}-${item.ratioIncrease}`}
                  >
                    <td>+{item.absoluteIncrease}건</td>
                    <td>{item.ratioIncrease}배</td>
                    <td>{item.events}</td>
                    <td>{fixed(item.negativeReturn12wPct, 1, "%")}</td>
                    <td>{signed(item.medianReturn12wPct, 1)}</td>
                    <td>{fixed(item.drawdown10Rate12wPct, 1, "%")}</td>
                    <td>{signed(item.medianDrawdown12wPct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny-note">
            +5건·5배 기준은 {relaxedSensitivity.events}개 사건으로 넓어지며 12주
            수익률 중앙값이 {signed(relaxedSensitivity.medianReturn12wPct, 1)}로
            바뀝니다. 반면 +10건 이상에서는 배수 조건을 바꿔도 현재 데이터의{" "}
            {highZoneSpike.episodes.length}개 사건과 결과가 유지됩니다. 기준
            선택 뒤 새 사건에서 검증해야 합니다.
          </p>
        </section>

        <section className="analysis-grid alert-conclusion-grid">
          <article className="surface analysis-card conclusion-card">
            <p className="eyebrow">자료가 뒷받침하는 결론</p>
            <h2 className="mt-2 text-xl font-semibold">확인된 부분</h2>
            <ul className="evidence-list">
              <li>
                <strong>위험 비대칭</strong>
                <span>
                  실시간 첫 경보의 12주 수익률 중앙값은{" "}
                  {signed(
                    highZoneSpike.firstTriggerSummary.medianReturn12wPct,
                    1,
                  )}
                  , -10% 이상 하락 경험은{" "}
                  {fixed(
                    highZoneSpike.firstTriggerSummary.drawdown10Rate12wPct,
                    1,
                    "%",
                  )}
                  였습니다.
                </span>
              </li>
              <li>
                <strong>평범한 고점권과 차이</strong>
                <span>
                  일반 고점권 12주 수익률 중앙값{" "}
                  {signed(ordinaryHighZone.medianReturnPct, 1)} 대비 실시간 첫
                  경보는{" "}
                  {signed(
                    highZoneSpike.firstTriggerSummary.medianReturn12wPct,
                    1,
                  )}
                  로 방향이 반대였습니다.
                </span>
              </li>
              <li>
                <strong>실제 사용 방법</strong>
                <span>
                  신규 매수와 수익 중인 포지션의 추가 매수(불타기)를 중단하고
                  비중과 손실 한도를 재검토할 근거가 있습니다.
                </span>
              </li>
            </ul>
          </article>
          <article className="surface analysis-card conclusion-card caution-card">
            <p className="eyebrow">자료만으로 확인할 수 없는 것</p>
            <h2 className="mt-2 text-xl font-semibold">확인되지 않은 부분</h2>
            <ul className="evidence-list">
              <li>
                <strong>정확한 고점 시점</strong>
                <span>
                  실시간 첫 경보 후에도 12주 MFE 중앙값이{" "}
                  {signed(
                    highZoneSpike.firstTriggerSummary.medianUpside12wPct,
                    1,
                  )}
                  라 고점의 끝은 알 수 없습니다.
                </span>
              </li>
              <li>
                <strong>즉시 숏 진입의 수익성</strong>
                <span>
                  실시간 첫 경보 후 4주 종가 하락은{" "}
                  {fixed(
                    highZoneSpike.firstTriggerSummary.negativeReturn4wPct,
                    1,
                    "%",
                  )}
                  뿐이므로 숏 신호로는 지지되지 않습니다.
                </span>
              </li>
              <li>
                <strong>충분한 사건 수</strong>
                <span>
                  독립 사건은 {highZoneSpike.episodes.length}개뿐이며 한 사건이
                  비율을 약{" "}
                  {fixed(100 / highZoneSpike.episodes.length, 1, "%p")}{" "}
                  움직입니다. 선택한 기준은 향후 사건으로 전진 검증해야 합니다.
                </span>
              </li>
            </ul>
          </article>
        </section>

        <section className="surface chart-section supporting-analysis-intro">
          <div className="section-head">
            <div>
              <p className="eyebrow">핵심 경보를 보완하는 분석</p>
              <h2>언급량과 가격의 일반적인 관계도 함께 보기</h2>
              <p className="section-note">
                아래 분석은 고점권 초대형 언급 경보와 다른 질문을 다룹니다. 모든
                주 또는 더 넓은 언급 급증을 사용해 관계의 방향, 시간에 따른
                변화, 실제 예측 가능성을 확인합니다. 핵심 경보의 매수 금지
                판단을 대체하지 않는 참고 자료입니다.
              </p>
            </div>
            <span className="result-pill">
              조회 기간 · {selectedRangeLabel}
            </span>
          </div>
        </section>

        <section className="analysis-grid">
          <article className="surface analysis-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">전체 주의 관계</p>
                <h2>언급량이 많았던 주와 이후 수익률</h2>
                <p className="section-note">
                  점 하나가 한 주입니다. 가로축은 그 주 언급량의 이전 52주 내
                  관심도 백분위이고, 세로축은 선택한 기간 이후 수익률입니다.
                </p>
              </div>
              <select
                aria-label="언급량 이후 가격을 확인할 기간"
                className="select-control"
                onChange={(event) => setHorizon(Number(event.target.value))}
                value={horizon}
              >
                {[1, 2, 4, 8, 12].map((value) => (
                  <option key={value} value={value}>
                    {value}주 뒤
                  </option>
                ))}
              </select>
            </div>
            <div className="chart-wrap">
              <CorrelationChart data={scatter} />
            </div>
          </article>
          <aside className="surface analysis-card">
            <p className="eyebrow">관계의 크기</p>
            <h2 className="mt-2 text-xl font-semibold">
              관심도만으로 이후 수익률을 설명할 수 있는가
            </h2>
            <div className="dual-stat">
              <div>
                <span>Pearson 상관계수</span>
                <strong>{fixed(correlation, 3)}</strong>
              </div>
              <div>
                <span>Spearman 순위상관계수</span>
                <strong>{fixed(rankCorrelation, 3)}</strong>
              </div>
            </div>
            <p className="sample-note">
              표본 {scatter.length}주 · {selectedRangeLabel} · {horizon}주 뒤
            </p>
            <ul className="method-list">
              <li>
                <b>01</b>
                <span>
                  두 상관계수는 -1에서 +1 사이이며 0에 가까우면 일관된 관계가
                  약하다는 뜻입니다.
                </span>
              </li>
              <li>
                <b>02</b>
                <span>
                  Pearson은 선형 관계, Spearman은 값의 순위에 따른 단조 관계를
                  측정합니다.
                </span>
              </li>
              <li>
                <b>03</b>
                <span>
                  관계가 보여도 원인이나 매매 수익을 증명하지는 않습니다.
                </span>
              </li>
            </ul>
          </aside>
        </section>

        <section className="analysis-grid event-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">더 넓은 언급 급증 기준</p>
            <h2 className="mt-2 text-xl font-semibold">
              가격 위치를 따지지 않은 언급 급증 이후
            </h2>
            <p className="section-note">
              고점권 여부와 무관하게, 그 주 언급량이 직전 52주 상위 5%에 들고
              이전 52주 중앙값보다 3건 이상 많으면 넓은 급증으로 봅니다. 핵심
              경보보다 느슨한 별도 기준입니다.
            </p>
            <div className="chart-wrap">
              <EventStudyChart data={broadSpikeEvents} />
            </div>
          </article>
          <article className="surface analysis-card table-card">
            <p className="eyebrow">넓은 급증 이후 세부 결과</p>
            <h2 className="mt-2 text-xl font-semibold">기간별 결과</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>경과 기간</th>
                    <th>사건 수</th>
                    <th>수익률 중앙값</th>
                    <th>상승 비율</th>
                    <th>MFE</th>
                    <th>MAE</th>
                    <th>95% 신뢰구간</th>
                  </tr>
                </thead>
                <tbody>
                  {broadSpikeEvents.map((item) => (
                    <tr key={item.horizon}>
                      <td>+{item.horizon}주</td>
                      <td>{item.events}</td>
                      <td>{signed(item.medianReturnPct)}</td>
                      <td>{fixed(item.hitRatePct, 1, "%")}</td>
                      <td>{signed(item.medianMfePct)}</td>
                      <td>{signed(item.medianMaePct)}</td>
                      <td>
                        {item.confidenceInterval
                          ? signed(item.confidenceInterval[0], 1) +
                            " ~ " +
                            signed(item.confidenceInterval[1], 1)
                          : "사건 8개 미만"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny-note">
              같은 가격 구간을 반복 계산하지 않도록 기간이 겹치는 급증은
              제외합니다. MFE는 구간 내 최대 상승폭, MAE는 최대 하락폭입니다.
              이동 블록 부트스트랩 95% 신뢰구간은 사건이 8개 이상일 때만
              표시합니다.
            </p>
          </article>
        </section>

        <section className="analysis-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">롤링 상관 분석</p>
            <h2 className="mt-2 text-xl font-semibold">52주 롤링 상관계수</h2>
            <p className="section-note">
              관심도 백분위(t)와 다음 1주 수익률(t+1)의 Pearson·Spearman
              상관계수를 매주 다시 계산합니다. 선이 0 위와 아래를 자주 오가면
              관계가 시기에 따라 달라져 상관관계가 안정적이지 않다는 뜻입니다.
            </p>
            <div className="chart-wrap">
              <RollingCorrelationChart data={rolling} />
            </div>
          </article>
          <article className="surface analysis-card table-card">
            <p className="eyebrow">시장 국면별 분석</p>
            <h2 className="mt-2 text-xl font-semibold">
              추세·변동성 국면별 차이
            </h2>
            <p className="section-note">
              추세 국면은 26주 이동평균, 변동성 국면은 이전 52주 실현변동성
              중앙값을 기준으로 나눕니다. 상관계수는 관심도 백분위와 다음 주
              수익률의 관계를 나타냅니다.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>시장 국면</th>
                    <th>표본 수</th>
                    <th>Pearson</th>
                    <th>Spearman</th>
                    <th>다음 주 수익률 중앙값</th>
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
                <p className="eyebrow">Granger 선행성 검정</p>
                <h2>언급량 변화가 BTC 수익률을 선행하는가</h2>
                <p className="section-note">
                  Δlog(1+언급량)과 BTC 로그수익률의 양방향 1~4주 Granger
                  검정입니다. 다중 검정은 Benjamini-Hochberg FDR로 보정합니다.
                </p>
              </div>
              <span
                className={`result-pill ${significantPrecedence ? "signal" : ""}`}
              >
                FDR q&lt;0.05 · {significantPrecedence}개
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>방향</th>
                    <th>시차</th>
                    <th>F 통계량</th>
                    <th>p-value</th>
                    <th>FDR q-value</th>
                    <th>판정</th>
                  </tr>
                </thead>
                <tbody>
                  {granger.tests.map((test) => (
                    <tr key={test.direction + "-" + test.lag}>
                      <td>
                        {test.direction === "attention_to_return"
                          ? "언급량 변화 → 수익률"
                          : "수익률 → 언급량 변화"}
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
              FDR q-value가 0.05보다 작을 때 통계적으로 유의하다고 판정합니다.
              Granger 선행성은 경제적 인과를 의미하지 않습니다. 전체 표본 n=
              {granger.observations}주입니다.
            </p>
          </article>
          <aside className="surface analysis-card validation-card">
            <p className="eyebrow">워크포워드 검증</p>
            <h2 className="mt-2 text-xl font-semibold">표본외 예측 성능</h2>
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
              최초 104주 이후 매주 이전 자료로 단순 선형모형을 재적합해 다음
              주를 예측했습니다. OOS R²가 0 이하면 과거 평균을 사용한 예측보다
              성능이 낮다는 뜻입니다.
            </p>
          </aside>
        </section>

        <section className="surface availability">
          <div>
            <p className="eyebrow">데이터 범위와 한계</p>
            <h2>현재 확인할 수 있는 것과 없는 것</h2>
          </div>
          <div className="availability-grid">
            <article>
              <strong>현재 분석</strong>
              <p>
                고점권 초대형 언급 경보, 실시간 첫 경보와 사후 언급량 정점 분리,
                1–12주 수익률과 MFE·MAE, 일반 고점권 비교, 경보 민감도 분석,
                상관·시장 국면·Granger 선행성·워크포워드 검증
              </p>
            </article>
            <article>
              <strong>분석 불가</strong>
              <p>
                과거 게시글 원문이 필요한 감성·주제, 과거 카페별 수치가 필요한
                확산도·집중도
              </p>
            </article>
            <article>
              <strong>해석 원칙</strong>
              <p>
                핵심 경보는 마감된 주만 사용하며 실시간 판단에는 “실시간 첫
                경보”만 쓸 수 있습니다. “언급량 정점”은 사후 설명용이고, 모든
                관계 분석은 원인이나 매매 수익을 보장하지 않습니다.
              </p>
            </article>
          </div>
        </section>

        <footer className="footer">
          <p>
            가격·거래량: {snapshot.collection.price.source}
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
