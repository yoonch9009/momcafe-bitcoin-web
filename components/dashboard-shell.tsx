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
  highZoneSpikeAnalysis,
  relativeChange,
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
  const [range, setRange] = useState<Range>("3y");
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
  const ordinaryHighZone = highZoneSpike.benchmark12w.find(
    (item) => item.key === "ordinary_high_zone",
  )!;
  const relaxedSensitivity = highZoneSpike.sensitivity.find(
    (item) => item.absoluteIncrease === 5 && item.ratioIncrease === 5,
  )!;

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
              저빈도 언급량을 52주 중앙값과 배수로 표준화하고, BTC 고점권에서
              발생한 초대형 사건의 이후 수익·낙폭과 운용 위험을 검증합니다.
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
              <p className="eyebrow">ALERT CONTEXT TIMELINE</p>
              <h2>경보 사건과 시장 반응</h2>
              <p className="section-note">
                막대는 주간 언급량, 선은 선택 지표, 주황색 세로선은 조회 기간에
                포함된 대표 고점입니다. 현재 주 값은 마감 전 누적치입니다.
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
                aria-label="타임라인 조회 기간"
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
              alertWeeks={highZoneSpike.episodes.map(
                (episode) => episode.representativePeak.week,
              )}
              data={timeline}
              logarithmic={logarithmic}
              metric={metric}
            />
          </div>
        </section>

        <section className="analysis-grid alert-analysis-grid">
          <article className="surface analysis-card">
            <p className="eyebrow">ALERT TIMING COMPARISON</p>
            <h2 className="mt-2 text-xl font-semibold">
              최초 경보와 대표 고점 이후 종가
            </h2>
            <p className="section-note">
              7개 독립 사건의 중앙 수익률입니다. 최초 경보는 실시간 사용 가능,
              대표 고점은 에피소드 종료 후에만 알 수 있는 설명용 기준입니다.
            </p>
            <div className="chart-wrap">
              <AlertPathChart data={alertPath} />
            </div>
          </article>
          <aside className="surface analysis-card validation-card">
            <p className="eyebrow">WHAT THE NUMBERS SAY</p>
            <h2 className="mt-2 text-xl font-semibold">경보의 정확한 의미</h2>
            <div className="validation-stat">
              <span>최초 경보 후 4주 종가 하락</span>
              <strong>
                {fixed(
                  highZoneSpike.firstTriggerSummary.negativeReturn4wPct,
                  1,
                  "%",
                )}
              </strong>
            </div>
            <div className="validation-stat">
              <span>대표 고점 후 4주 종가 하락</span>
              <strong>
                {fixed(
                  highZoneSpike.representativePeakSummary.negativeReturn4wPct,
                  1,
                  "%",
                )}
              </strong>
            </div>
            <div className="validation-stat">
              <span>최초 경보 후 12주 최대 상승 중앙값</span>
              <strong>
                {signed(
                  highZoneSpike.firstTriggerSummary.medianUpside12wPct,
                  1,
                )}
              </strong>
            </div>
            <p className="tiny-note">
              최초 경보 직후 4주는 하락보다 상승 종가가 많았습니다. 따라서 숏
              진입점이 아니라 추격매수·불타기 중단 시점으로 해석합니다.
            </p>
          </aside>
        </section>

        <section className="analysis-grid event-grid alert-tables-grid">
          <article className="surface analysis-card table-card">
            <p className="eyebrow">HOLDING-PERIOD RISK</p>
            <h2 className="mt-2 text-xl font-semibold">기간별 위험 경로</h2>
            <p className="section-note">
              같은 7개 사건을 1·2·4·8·12주 지평으로 비교합니다. MAE는 해당 기간
              중 저점 기준 최대 낙폭의 중앙값입니다.
            </p>
            <div className="table-scroll">
              <table className="data-table alert-detail-table">
                <thead>
                  <tr>
                    <th>지평</th>
                    <th>최초 경보 수익</th>
                    <th>대표 고점 수익</th>
                    <th>최초 경보 MAE</th>
                    <th>대표 고점 MAE</th>
                    <th>최초 경보 MFE</th>
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
            <p className="eyebrow">HIGH-ZONE BENCHMARK</p>
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
                    <th>n</th>
                    <th>12주 하락</th>
                    <th>중앙수익</th>
                    <th>-10% 경험</th>
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
              일반 고점권 n은 중첩된 주간 관측치이므로 독립 사건 7개와 동일한
              유의성 표본으로 해석하지 않고 방향·크기 비교에만 사용합니다.
            </p>
          </article>
        </section>

        <section className="surface chart-section sensitivity-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">THRESHOLD SENSITIVITY</p>
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
                  <th>절대 증가</th>
                  <th>비율</th>
                  <th>사건 수</th>
                  <th>12주 하락</th>
                  <th>12주 중앙수익</th>
                  <th>-10% 하락 경험</th>
                  <th>MAE 중앙값</th>
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
            중앙수익이 {signed(relaxedSensitivity.medianReturn12wPct, 1)}로
            바뀝니다. 반면 +10건 이상에서는 배수 조건을 바꿔도 현재 데이터의{" "}
            {highZoneSpike.episodes.length}개 사건과 결과가 유지됩니다. 기준
            선택 뒤 새 사건에서 검증해야 합니다.
          </p>
        </section>

        <section className="analysis-grid alert-conclusion-grid">
          <article className="surface analysis-card conclusion-card">
            <p className="eyebrow">SUPPORTED CONCLUSION</p>
            <h2 className="mt-2 text-xl font-semibold">확인된 부분</h2>
            <ul className="evidence-list">
              <li>
                <strong>위험 비대칭</strong>
                <span>
                  최초 경보의 12주 중앙수익은{" "}
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
                  일반 고점권 12주 중앙수익{" "}
                  {signed(ordinaryHighZone.medianReturnPct, 1)} 대비 최초 경보는{" "}
                  {signed(
                    highZoneSpike.firstTriggerSummary.medianReturn12wPct,
                    1,
                  )}
                  로 방향이 반대였습니다.
                </span>
              </li>
              <li>
                <strong>운용 신호</strong>
                <span>
                  신규 매수·불타기·피라미딩을 중단하고 비중과 손실 한도를
                  재검토할 근거가 있습니다.
                </span>
              </li>
            </ul>
          </article>
          <article className="surface analysis-card conclusion-card caution-card">
            <p className="eyebrow">NOT PROVEN</p>
            <h2 className="mt-2 text-xl font-semibold">확인되지 않은 부분</h2>
            <ul className="evidence-list">
              <li>
                <strong>정확한 고점 시점</strong>
                <span>
                  최초 경보 후에도 12주 최대 상승 중앙값이{" "}
                  {signed(
                    highZoneSpike.firstTriggerSummary.medianUpside12wPct,
                    1,
                  )}
                  라 고점의 끝은 알 수 없습니다.
                </span>
              </li>
              <li>
                <strong>즉시 숏 수익성</strong>
                <span>
                  최초 경보 후 4주 종가 하락은{" "}
                  {fixed(
                    highZoneSpike.firstTriggerSummary.negativeReturn4wPct,
                    1,
                    "%",
                  )}
                  뿐이므로 하락 베팅 신호로는 지지되지 않습니다.
                </span>
              </li>
              <li>
                <strong>통계적 확증</strong>
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

        <section className="surface availability">
          <div>
            <p className="eyebrow">DATA BOUNDARY</p>
            <h2>가능한 분석과 불가능한 추정의 경계</h2>
          </div>
          <div className="availability-grid">
            <article>
              <strong>현재 제공</strong>
              <p>
                고점권 초대형 언급 경보, 최초 경보·대표 고점 분리, 1–12주
                수익·MFE·MAE, 일반 고점권 비교, 기준 민감도
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
                확정 주만 사용하며 실시간 판단은 최초 경보만 가능합니다. 대표
                고점은 사후 설명용이고 사건 연구는 인과나 매매 수익성을 보장하지
                않습니다.
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
