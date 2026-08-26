import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const analysisPath = path.join(reportDir, "analysis-results.json");
const spikeRiskPath = path.join(reportDir, "spike-top-risk-results.json");
const artifactPath = path.join(reportDir, "momcafe-analysis-artifact.json");
const sqlitePath = path.join(reportDir, "report-data.sqlite");
const sqlPath = path.join(reportDir, "report-source.sql");
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
const spikeRisk = JSON.parse(fs.readFileSync(spikeRiskPath, "utf8"));

const generatedAt = analysis.generatedAt;

const pctText = (value, digits = 1) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;

const correlationRows = analysis.correlations.map((row) => ({
  ...row,
  horizon: `+${row.horizonWeeks}주`,
}));

const eventRows = analysis.events.map((row) => ({
  ...row,
  horizon: `+${row.horizonWeeks}주`,
  confidenceInterval:
    row.ciLowPct === null
      ? "표본 부족"
      : `${pctText(row.ciLowPct)} ~ ${pctText(row.ciHighPct)}`,
}));

const leadLagRows = analysis.leadLag.map((row) => ({
  ...row,
  strongestLagLabel:
    row.strongestLag === 0
      ? "동시"
      : row.strongestLag > 0
        ? `관심 +${row.strongestLag}주 선행`
        : `시장 ${Math.abs(row.strongestLag)}주 선행`,
}));

const grangerRows = analysis.granger.tests.map((row) => ({
  ...row,
  directionLabel:
    row.direction === "attention_to_return" ? "관심 → 수익률" : "수익률 → 관심",
  verdict: row.qValue < 0.05 ? "유의" : "비유의",
}));

const latest3yRolling = analysis.rolling.rows.slice(-156).flatMap((row) => [
  {
    week: row.week,
    metric: "Pearson",
    correlation: row.pearson,
    observations: row.observations,
  },
  {
    week: row.week,
    metric: "Spearman",
    correlation: row.spearman,
    observations: row.observations,
  },
]);
const recentCorrelations = correlationRows.filter(
  (row) => row.scope === "최근 3년",
);
const recentLeadLag = leadLagRows.filter((row) => row.scope === "최근 3년");
const fullEvents = eventRows.filter((row) => row.scope === "전체 기간");
const recentEvents = eventRows.filter((row) => row.scope === "최근 3년");
const recentRegimes = analysis.regimes.filter(
  (row) => row.scope === "최근 3년",
);

const headline = [
  {
    attentionPercentile: analysis.latestCompleted.attentionPercentile,
    postCount: analysis.latestCompleted.postCount,
    mentionChange4w: analysis.latestCompleted.mentionChange4w,
    correlation3y1w: recentCorrelations.find((row) => row.horizonWeeks === 1)
      .spearman,
    walkForwardR2: analysis.walkForward.oosR2,
    directionalAccuracyPct: analysis.walkForward.directionalAccuracyPct,
    zeroRatePct: analysis.countProfiles.completedHistory.zeroRatePct,
    varianceToMean: analysis.countProfiles.completedHistory.varianceToMean,
  },
];

const highZone12 = spikeRisk.highZoneSpikes.find(
  (row) => row.horizonWeeks === 12,
);
const extremeHighZone12 = spikeRisk.extremeHighZoneSpikes.find(
  (row) => row.horizonWeeks === 12,
);
const extremeHighZone4 = spikeRisk.extremeHighZoneSpikes.find(
  (row) => row.horizonWeeks === 4,
);
const spikeRiskHeadline = [
  {
    highZoneEvents: highZone12.events,
    highZonePositive12Pct: highZone12.positiveReturnRatePct,
    highZoneMedianReturn12Pct: highZone12.medianReturnPct,
    highZoneMedianUpside12Pct: highZone12.medianMaxUpsidePct,
    highZoneDrawdown10Rate12Pct: highZone12.drawdown10RatePct,
    extremeEvents: extremeHighZone12.events,
    extremeNegativeReturnRate4Pct:
      100 - extremeHighZone4.positiveReturnRatePct,
    extremeDrawdown10Rate4Pct: extremeHighZone4.drawdown10RatePct,
    extremeMedianReturn4Pct: extremeHighZone4.medianReturnPct,
    extremeMedianReturn12Pct: extremeHighZone12.medianReturnPct,
    extremeMedianUpside12Pct: extremeHighZone12.medianMaxUpsidePct,
    extremeMedianDrawdown12Pct: extremeHighZone12.medianMaxDrawdownPct,
  },
];

const spikeRiskComparison = [
  [`넓은 고점권 스파이크 (${highZone12.events}건)`, highZone12],
  [`초대형 고점권 스파이크 (${extremeHighZone12.events}건)`, extremeHighZone12],
].flatMap(([cohort, row]) => [
  { cohort, metric: "12주 중앙수익", value: row.medianReturnPct },
  { cohort, metric: "12주 중앙 최대상승", value: row.medianMaxUpsidePct },
  {
    cohort,
    metric: "12주 중앙 최대낙폭(절대값)",
    value: Math.abs(row.medianMaxDrawdownPct),
  },
]);

const extremeEventRows = spikeRisk.events
  .filter((row) => row.isExtremeHighZoneEpisodePeak)
  .map((row) => ({
    ...row,
    topRiskVerdict: row.topRisk12w ? "고점 위험 충족" : "미충족",
  }));

const extremeSensitivityRows = spikeRisk.extremeSensitivity.map((row) => ({
  ...row,
  thresholdLabel: `중앙값 +${row.excessThreshold}건`,
}));

const datasets = {
  headline,
  spike_risk_headline: spikeRiskHeadline,
  spike_risk_comparison: spikeRiskComparison,
  extreme_spike_events: extremeEventRows,
  extreme_spike_sensitivity: extremeSensitivityRows,
  mention_distribution: analysis.distribution,
  correlations: correlationRows,
  attention_buckets: analysis.attentionBuckets,
  lead_lag: leadLagRows,
  recent_lead_lag: recentLeadLag,
  events: eventRows,
  recent_events: recentEvents,
  full_events: fullEvents,
  rolling_3y: latest3yRolling,
  regimes: analysis.regimes,
  recent_regimes: recentRegimes,
  granger: grangerRows,
  quality: [analysis.quality],
};

if (fs.existsSync(sqlitePath)) fs.rmSync(sqlitePath);
const database = new DatabaseSync(sqlitePath);

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const tableSql = [];
for (const [datasetId, rows] of Object.entries(datasets)) {
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columnType = (field) => {
    const values = rows
      .map((row) => row[field])
      .filter((value) => value !== null);
    if (values.every((value) => typeof value === "boolean")) return "INTEGER";
    if (
      values.every(
        (value) => typeof value === "number" && Number.isInteger(value),
      )
    )
      return "INTEGER";
    if (values.every((value) => typeof value === "number")) return "REAL";
    return "TEXT";
  };
  database.exec(
    `CREATE TABLE ${quoteIdentifier(datasetId)} (${fields
      .map((field) => `${quoteIdentifier(field)} ${columnType(field)}`)
      .join(", ")})`,
  );
  const placeholders = fields.map(() => "?").join(", ");
  const insert = database.prepare(
    `INSERT INTO ${quoteIdentifier(datasetId)} (${fields
      .map(quoteIdentifier)
      .join(", ")}) VALUES (${placeholders})`,
  );
  database.exec("BEGIN");
  const sqliteValue = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (["string", "number", "bigint"].includes(typeof value)) return value;
    return JSON.stringify(value);
  };
  for (const row of rows)
    insert.run(...fields.map((field) => sqliteValue(row[field])));
  database.exec("COMMIT");
  tableSql.push(`SELECT * FROM ${quoteIdentifier(datasetId)};`);
}
database.close();

const sourceSql = [
  "-- Final report datasets projected from reports/analysis-results.json and reports/spike-top-risk-results.json.",
  "-- The upstream calculations are reproduced by reports/analyze-momcafe-results.mjs and reports/analyze-spike-top-risk.mjs.",
  ...tableSql,
].join("\n");
fs.writeFileSync(sqlPath, `${sourceSql}\n`, "utf8");

const source = {
  id: "momcafe-analysis",
  label: "맘카페 × BTC 주간 분석 산출물 (public/data.json + lib/statistics.ts)",
  path: "reports/report-source.sql",
  href: "https://github.com/yoonch9009/momcafe-bitcoin-web/blob/main/public/data.json",
  query: {
    engine: "SQLite (node:sqlite)",
    language: "SQL",
    sql: sourceSql,
    description:
      "재현 가능한 JavaScript 분석 결과를 보고서용 SQLite 표로 투영한 최종 조회",
    executed_at: generatedAt,
    tables_used: Object.keys(datasets),
    filters: [
      "Asia/Seoul 월요일 시작 주간 단위",
      "헤드라인과 분포는 완료 주만 사용",
      "기본 화면 비교 구간은 마지막 156주(최근 3년)",
      "고점 가설은 조건 충족 주가 2주 이하 간격으로 이어질 때 한 사건으로 묶고 언급량 최고점을 대표일로 사용",
    ],
    metric_definitions: [
      "관심도 백분위: 직전 최대 52주의 언급량보다 낮은 값과 동률의 절반을 합친 경험적 순위",
      "급증 사건: 직전 52주 95백분위 이상이면서 중앙값보다 최소 3건 많은 완료 주",
      "고점권: 사건 주 종가가 직전 26주 최고 종가의 10% 이내",
      "초대형 급증: 95백분위와 별개로 직전 52주 중앙값보다 최소 10건 많음",
      "12주 고점 위험: 최대 상승여력 10% 이하이면서 최대 낙폭 -10% 이하",
      "표본외 R²: 최초 104개 관측 이후 매주 과거 데이터만으로 재적합한 선형모형과 과거평균 예측의 오차 비교",
    ],
  },
};

const cards = [
  {
    id: "current-attention",
    description: "마지막 완료 주(2026-08-17)의 상대적 언급 수준",
    dataset: "headline",
    sourceId: source.id,
    metrics: [
      {
        label: "관심도 백분위 (0–100)",
        field: "attentionPercentile",
        format: "number",
      },
      { label: "언급량", field: "postCount", format: "number" },
      {
        label: "4주 변화",
        field: "mentionChange4w",
        format: "number",
        signed: true,
      },
    ],
  },
  {
    id: "direction-correlation",
    description: "최근 3년 관심도와 다음 1주 수익률의 순위 상관",
    dataset: "headline",
    sourceId: source.id,
    metrics: [
      {
        label: "Spearman 상관",
        field: "correlation3y1w",
        format: "number",
        signed: true,
      },
    ],
  },
  {
    id: "walk-forward",
    description: "과거 데이터만 사용한 표본외 예측 성능",
    dataset: "headline",
    sourceId: source.id,
    metrics: [
      {
        label: "표본외 R²",
        field: "walkForwardR2",
        format: "number",
        signed: true,
      },
      {
        label: "방향 적중률 (%)",
        field: "directionalAccuracyPct",
        format: "number",
      },
    ],
  },
  {
    id: "sparse-data",
    description: "완료 546주의 저빈도·과산포 정도",
    dataset: "headline",
    sourceId: source.id,
    metrics: [
      { label: "0건 주 비중 (%)", field: "zeroRatePct", format: "number" },
      { label: "분산/평균", field: "varianceToMean", format: "number" },
    ],
  },
  {
    id: "broad-high-zone-result",
    description: "고점권의 모든 상대적 급증, 향후 12주",
    dataset: "spike_risk_headline",
    sourceId: source.id,
    metrics: [
      { label: "사건 수", field: "highZoneEvents", format: "number" },
      {
        label: "상승 마감 비율 (%)",
        field: "highZonePositive12Pct",
        format: "number",
      },
      {
        label: "중앙수익률 (%)",
        field: "highZoneMedianReturn12Pct",
        format: "number",
        signed: true,
      },
    ],
  },
  {
    id: "broad-upside-risk",
    description: "넓은 고점권 급증 뒤의 경로 위험",
    dataset: "spike_risk_headline",
    sourceId: source.id,
    metrics: [
      {
        label: "중앙 최대상승 (%)",
        field: "highZoneMedianUpside12Pct",
        format: "number",
      },
      {
        label: "-10% 낙폭 경험률 (%)",
        field: "highZoneDrawdown10Rate12Pct",
        format: "number",
      },
    ],
  },
  {
    id: "extreme-high-zone-result",
    description: "고점권이면서 중앙값보다 10건 이상 많은 초대형 급증",
    dataset: "spike_risk_headline",
    sourceId: source.id,
    metrics: [
      { label: "사건 수", field: "extremeEvents", format: "number" },
      {
        label: "4주 하락 마감 비율 (%)",
        field: "extremeNegativeReturnRate4Pct",
        format: "number",
      },
      {
        label: "4주 내 -10% 낙폭 경험률 (%)",
        field: "extremeDrawdown10Rate4Pct",
        format: "number",
      },
    ],
  },
  {
    id: "extreme-path-result",
    description: "초대형 고점권 급증 뒤의 가격 경로",
    dataset: "spike_risk_headline",
    sourceId: source.id,
    metrics: [
      {
        label: "4주 중앙수익률 (%)",
        field: "extremeMedianReturn4Pct",
        format: "number",
        signed: true,
      },
      {
        label: "12주 중앙 최대낙폭 (%)",
        field: "extremeMedianDrawdown12Pct",
        format: "number",
        signed: true,
      },
      {
        label: "12주 중앙수익률 (%)",
        field: "extremeMedianReturn12Pct",
        format: "number",
        signed: true,
      },
      {
        label: "12주 중앙 최대상승 (%)",
        field: "extremeMedianUpside12Pct",
        format: "number",
      },
    ],
  },
];

const charts = [
  {
    id: "mention-distribution",
    title: "주간 언급량 분포",
    subtitle: "완료 546주, 2016년 3월 7일–2026년 8월 17일",
    showDescription: true,
    intent: "comparison",
    question: "언급량이 일반적인 연속형 지표처럼 분포하는가?",
    rationale:
      "이미 집계된 구간별 주 수를 비교하므로 0에서 시작하는 막대가 가장 직접적입니다.",
    comparisonContext: {
      grain: "주",
      denominator: "완료 546주",
      unit: "주 수",
      semanticFamily: "언급량 분포",
    },
    type: "bar",
    dataset: "mention_distribution",
    sourceId: source.id,
    encodings: {
      x: { field: "bin", type: "ordinal", label: "주간 언급량" },
      y: {
        field: "weeks",
        type: "quantitative",
        label: "주 수",
        aggregate: "none",
      },
      tooltip: [
        { field: "weeks", type: "quantitative", label: "주 수" },
        {
          field: "sharePct",
          type: "quantitative",
          label: "전체 비중",
          unit: "%",
        },
      ],
    },
    valueFormat: "number",
    palette: { kind: "sequential", name: "blue" },
    settings: { sort: "custom", showValues: true },
    labels: { values: "auto" },
    surface: { surface: "export", viewMode: "both" },
    layout: "full",
  },
  {
    id: "correlation-horizons",
    title: "관심도와 이후 수익률의 순위 상관",
    subtitle: "최근 3년과 전체 기간 비교, +1·2·4·8주",
    showDescription: true,
    intent: "comparison",
    question: "관심도가 이후 BTC 방향을 일관되게 설명하는가?",
    rationale:
      "네 개의 이산 지평에서 두 기간의 상관 부호와 크기를 직접 비교합니다.",
    comparisonContext: {
      grain: "주",
      baseline: "전체 기간",
      unit: "Spearman ρ",
      semanticFamily: "선행 수익률 상관",
    },
    type: "bar",
    dataset: "correlations",
    sourceId: source.id,
    encodings: {
      x: { field: "horizon", type: "ordinal", label: "예측 지평" },
      y: {
        field: "spearman",
        type: "quantitative",
        label: "Spearman ρ",
        aggregate: "none",
      },
      color: { field: "scope", type: "nominal", label: "분석 기간" },
      tooltip: [
        { field: "observations", type: "quantitative", label: "관측 수" },
        { field: "pearson", type: "quantitative", label: "Pearson" },
      ],
    },
    palette: { kind: "categorical", name: "blue-orange" },
    legend: { position: "bottom", sort: "spec" },
    referenceLines: [
      {
        axis: "y",
        value: 0,
        label: "상관 없음",
        color: "neutral",
        lineStyle: "dashed",
      },
    ],
    settings: { groupMode: "grouped", sort: "custom", showValues: true },
    labels: { values: "auto" },
    surface: { surface: "export", viewMode: "both" },
    layout: "full",
  },
  {
    id: "rolling-correlation",
    title: "52주 롤링 상관",
    subtitle: "관심도 백분위와 다음 1주 수익률, 최근 3년",
    showDescription: true,
    intent: "trend",
    question: "관심도와 다음 주 수익률의 관계가 시간에 따라 안정적인가?",
    rationale: "156개 주간 창의 상관 부호와 크기 변화를 연속적으로 확인합니다.",
    comparisonContext: {
      grain: "52주 이동창",
      unit: "상관계수",
      semanticFamily: "시간가변 상관",
    },
    type: "line",
    dataset: "rolling_3y",
    sourceId: source.id,
    encodings: {
      x: { field: "week", type: "temporal", label: "기준 주" },
      y: {
        field: "correlation",
        type: "quantitative",
        label: "상관계수",
        aggregate: "none",
      },
      color: { field: "metric", type: "nominal", label: "상관 방식" },
      lineStyle: { field: "metric", type: "nominal", label: "상관 방식" },
      tooltip: [
        { field: "observations", type: "quantitative", label: "창 내 관측 수" },
      ],
    },
    palette: { kind: "categorical", name: "blue-orange" },
    legend: { position: "bottom", sort: "spec" },
    referenceLines: [
      {
        axis: "y",
        value: 0,
        label: "상관 없음",
        color: "neutral",
        lineStyle: "dashed",
      },
    ],
    settings: { showPoints: "never", showLatestValue: true },
    surface: { surface: "export", viewMode: "both" },
    layout: "full",
  },
  {
    id: "contemporaneous-relationship",
    title: "관심도와 시장 지표의 동시 상관",
    subtitle: "최근 3년 Spearman ρ, 같은 주 기준",
    showDescription: true,
    intent: "comparison",
    question: "관심도는 가격 방향보다 시장 활동 강도와 더 가까운가?",
    rationale: "다섯 시장 결과의 동시 상관 크기를 한 축에서 비교합니다.",
    comparisonContext: {
      grain: "주",
      unit: "Spearman ρ",
      semanticFamily: "동시 관계",
    },
    type: "horizontalBar",
    dataset: "recent_lead_lag",
    sourceId: source.id,
    encodings: {
      x: { field: "label", type: "nominal", label: "시장 지표" },
      y: {
        field: "contemporaneousSpearman",
        type: "quantitative",
        label: "Spearman ρ",
        aggregate: "none",
      },
      tooltip: [
        {
          field: "strongestSpearman",
          type: "quantitative",
          label: "±8주 내 최대 |ρ|의 부호값",
        },
        { field: "strongestLagLabel", type: "text", label: "최대 상관 시차" },
      ],
    },
    palette: { kind: "diverging", name: "blue-orange", midpoint: 0 },
    referenceLines: [
      {
        axis: "y",
        value: 0,
        label: "상관 없음",
        color: "neutral",
        lineStyle: "dashed",
      },
    ],
    settings: { sort: "descending", showValues: true },
    labels: { values: "all" },
    surface: { surface: "export", viewMode: "both" },
    layout: "full",
  },
  {
    id: "spike-risk-comparison",
    title: "고점권 급증의 범위를 좁히면 결과가 달라집니다",
    subtitle: "향후 12주 중앙값, 최대낙폭은 절대값으로 표시",
    showDescription: true,
    intent: "comparison",
    question: "모든 상대적 급증과 초대형 급증의 결과가 같은가?",
    rationale:
      "두 규칙의 표본 수와 상승여력·낙폭 차이를 같은 축에서 직접 비교합니다.",
    comparisonContext: {
      grain: "8주 중복 제거 사건",
      unit: "%",
      semanticFamily: "고점 위험 경로",
    },
    type: "bar",
    dataset: "spike_risk_comparison",
    sourceId: source.id,
    encodings: {
      x: { field: "cohort", type: "ordinal", label: "급증 규칙" },
      y: {
        field: "value",
        type: "quantitative",
        label: "%",
        aggregate: "none",
      },
      color: { field: "metric", type: "nominal", label: "결과" },
      tooltip: [
        { field: "metric", type: "text", label: "측정값" },
        { field: "value", type: "quantitative", label: "값", unit: "%" },
      ],
    },
    palette: { kind: "categorical", name: "blue-orange" },
    legend: { position: "bottom", sort: "spec" },
    referenceLines: [
      {
        axis: "y",
        value: 0,
        label: "0%",
        color: "neutral",
        lineStyle: "dashed",
      },
    ],
    settings: { groupMode: "grouped", sort: "custom", showValues: true },
    labels: { values: "all" },
    surface: { surface: "export", viewMode: "both" },
    layout: "full",
  },
];

const tables = [
  {
    id: "event-results",
    title: "급증 사건 이후 결과",
    subtitle: "최근 3년과 전체 기간, 지평별 비중첩 사건",
    showDescription: true,
    dataset: "events",
    sourceId: source.id,
    defaultSort: { field: "scope", direction: "desc" },
    density: "spacious",
    layout: "full",
    columns: [
      { field: "scope", label: "기간", type: "text" },
      { field: "horizon", label: "지평", type: "text" },
      { field: "events", label: "사건 수", format: "number" },
      {
        field: "medianReturnPct",
        label: "사건 중앙수익 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "baselineMedianReturnPct",
        label: "전체 주 중앙수익 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "medianExcessPct",
        label: "중앙 차이 (%p)",
        format: "number",
        movement: true,
      },
      { field: "hitRatePct", label: "상승률 (%)", format: "number" },
      {
        field: "medianMaePct",
        label: "중앙 MAE (%)",
        format: "number",
        movement: true,
      },
      { field: "confidenceInterval", label: "중앙수익 95% CI", type: "text" },
    ],
  },
  {
    id: "lead-lag-results",
    title: "±8주 선행·후행 요약",
    subtitle: "각 시장 지표에서 절대값이 가장 큰 Spearman 상관",
    showDescription: true,
    dataset: "lead_lag",
    sourceId: source.id,
    defaultSort: { field: "scope", direction: "desc" },
    density: "spacious",
    layout: "full",
    columns: [
      { field: "scope", label: "기간", type: "text" },
      { field: "label", label: "시장 지표", type: "text" },
      { field: "strongestLagLabel", label: "최대 상관 시차", type: "text" },
      {
        field: "strongestSpearman",
        label: "최대 Spearman",
        format: "number",
        movement: true,
      },
      {
        field: "contemporaneousSpearman",
        label: "동시 Spearman",
        format: "number",
        movement: true,
      },
      { field: "attentionLeadLag", label: "관심 선행 지평", format: "number" },
      {
        field: "attentionLeadSpearman",
        label: "관심 선행 최대 ρ",
        format: "number",
        movement: true,
      },
    ],
  },
  {
    id: "regime-results",
    title: "시장 체제별 관심도–다음 주 수익률",
    subtitle: "추세와 변동성 체제별 최근 3년·전체 기간 비교",
    showDescription: true,
    dataset: "regimes",
    sourceId: source.id,
    defaultSort: { field: "scope", direction: "desc" },
    density: "spacious",
    layout: "full",
    columns: [
      { field: "scope", label: "기간", type: "text" },
      { field: "regime", label: "시장 체제", type: "text" },
      { field: "observations", label: "관측 수", format: "number" },
      { field: "pearson", label: "Pearson", format: "number", movement: true },
      {
        field: "spearman",
        label: "Spearman",
        format: "number",
        movement: true,
      },
      {
        field: "medianNextReturnPct",
        label: "다음 주 중앙수익 (%)",
        format: "number",
        movement: true,
      },
    ],
  },
  {
    id: "granger-results",
    title: "Granger 선행성 검정",
    subtitle: "1–4주 양방향, Benjamini–Hochberg FDR 보정",
    showDescription: true,
    dataset: "granger",
    sourceId: source.id,
    defaultSort: { field: "directionLabel", direction: "asc" },
    density: "spacious",
    layout: "full",
    columns: [
      { field: "directionLabel", label: "방향", type: "text" },
      { field: "lag", label: "시차 (주)", format: "number" },
      { field: "fStatistic", label: "F", format: "number" },
      { field: "pValue", label: "p", format: "number" },
      { field: "qValue", label: "FDR q", format: "number" },
      { field: "verdict", label: "판정", type: "text" },
    ],
  },
  {
    id: "extreme-spike-events",
    title: `고점권 초대형 급증의 실제 ${extremeEventRows.length}개 사건`,
    subtitle: "중앙값 대비 +10건 이상, 2주 이내 연결 구간의 최고 언급량 주",
    showDescription: true,
    dataset: "extreme_spike_events",
    sourceId: source.id,
    defaultSort: { field: "week", direction: "asc" },
    density: "spacious",
    layout: "full",
    columns: [
      { field: "week", label: "사건 주", type: "text" },
      { field: "postCount", label: "언급량", format: "number" },
      { field: "baselineMedian", label: "52주 중앙값", format: "number" },
      { field: "mentionExcess", label: "중앙값 대비", format: "number" },
      {
        field: "distanceFromPriorHighPct",
        label: "직전 고점 대비 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "return4wPct",
        label: "+4주 수익 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "return12wPct",
        label: "+12주 수익 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "maxUpside12wPct",
        label: "12주 최대상승 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "maxDrawdown12wPct",
        label: "12주 최대낙폭 (%)",
        format: "number",
        movement: true,
      },
      { field: "topRiskVerdict", label: "고점 위험", type: "text" },
    ],
  },
  {
    id: "extreme-spike-sensitivity",
    title: "초대형 기준 민감도",
    subtitle: "고점권 사건, 향후 12주; 기준을 결과에 맞춰 고르지 않기 위한 점검",
    showDescription: true,
    dataset: "extreme_spike_sensitivity",
    sourceId: source.id,
    defaultSort: { field: "excessThreshold", direction: "asc" },
    density: "spacious",
    layout: "full",
    columns: [
      {
        field: "excessThreshold",
        label: "중앙값 대비 기준 (건)",
        format: "number",
      },
      { field: "thresholdLabel", label: "초대형 기준", type: "text" },
      { field: "events", label: "사건 수", format: "number" },
      {
        field: "medianReturnPct",
        label: "12주 중앙수익 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "medianMaxUpsidePct",
        label: "중앙 최대상승 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "medianMaxDrawdownPct",
        label: "중앙 최대낙폭 (%)",
        format: "number",
        movement: true,
      },
      {
        field: "topRiskRatePct",
        label: "고점 위험 충족률 (%)",
        format: "number",
      },
    ],
  },
];

const blocks = [
  {
    id: "title",
    type: "markdown",
    body: "# 맘카페 언급량 × 비트코인 분석 해석 보고서",
  },
  {
    id: "executive-summary",
    type: "markdown",
    sourceId: source.id,
    body: `## Executive Summary\n\n- **현재 언급량은 평범한 수준입니다.** 마지막 완료 주인 2026년 8월 17일은 3건, 직전 52주 대비 46백분위이며 중앙값도 3건입니다. 4주 전보다 1건 늘었지만 급증으로 볼 근거는 없습니다.\n- **언급량은 BTC 방향 예측보다 시장이 시끄러운 정도를 보여줍니다.** 최근 3년 동시 상관은 수익률 -0.010에 불과하지만 실현변동성 0.379, 고저 변동폭 0.371입니다. 즉 언급이 많을수록 같은 주의 움직임이 큰 경향이 더 뚜렷합니다.\n- **수정된 초대형 고점권 급증 7건은 매수·피라미딩 금지 경보 가설을 지지합니다.** 4주 뒤 하락 마감이 5건(71.4%), 중앙수익률 -3.0%, 4주 안에 -10% 이상 하락을 경험한 사건이 6건(85.7%)이었습니다. 12주 중앙수익률은 -19.2%, 중앙 최대낙폭은 -25.2%였습니다.\n- **즉시 숏 신호로는 여전히 부적합합니다.** 일반 고점권 급증 15건의 12주 중앙 최대상승은 +46.4%였고, 초대형 사건 중에도 2017년 12월은 하락 전 +30.1%, 2021년 1월은 이후 +61.9% 상승했습니다. 따라서 초대형 급증은 신규 추격·불타기·피라미딩 보류와 비중 재점검 경보로 사용하되 자동 매도·숏은 하지 않는 것이 데이터에 맞습니다.`,
  },
  {
    id: "headline-metrics",
    type: "metric-strip",
    cardIds: [
      "current-attention",
      "direction-correlation",
      "walk-forward",
      "sparse-data",
    ],
  },
  {
    id: "data-shape",
    type: "markdown",
    sourceId: source.id,
    body: `## 언급량은 연속형 신호가 아니라 희소한 사건 계수입니다\n\n완료 546주의 중앙값은 2건이고 43.8%가 0–1건입니다. 반면 평균은 4.2건, 최대는 91건이며 분산은 평균의 15.6배입니다. 이 구조에서는 0→1건을 100% 증가로 표현하거나 평균·표준편차만으로 이상치를 판단하면 과장됩니다.\n\n**해석:** 현재의 52주 경험적 백분위와 절대 건수 변화가 데이터에 맞습니다. 최근 52주의 중앙값은 3건, 0건 비중은 5.8%로 장기 평균보다 활동 수준이 조금 높아졌으므로 고정 임계값보다 이동 기준선을 유지해야 합니다.`,
  },
  { id: "distribution-chart", type: "chart", chartId: "mention-distribution" },
  {
    id: "current-reading",
    type: "markdown",
    sourceId: source.id,
    body: `## 현재 값은 중립이며, 직후 가격 상승은 단일 사례입니다\n\n2026년 8월 17일의 3건은 46백분위로 직전 52주의 정확한 중간 수준입니다. 4주 전 2건에서 1건 증가했지만 급증 조건인 ‘52주 상위 5%이면서 중앙값보다 3건 이상’을 충족하지 않습니다. 다음 주 BTC 수익률은 +1.62%였지만 관측 1건으로 관계를 추론할 수 없습니다.\n\n**결론:** 지금 언급량만으로는 강세·약세 어느 쪽도 지지하지 않습니다.`,
  },
  {
    id: "direction-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## 가격 방향과의 관계는 약하고 기간에 따라 반대로 보입니다\n\n최근 3년의 관심도–이후 수익률 Spearman 상관은 +1주 -0.079, +2주 -0.065, +4주 -0.131, +8주 -0.149입니다. 모두 약한 음의 관계입니다. 반면 전체 기간은 같은 순서로 +0.065, +0.091, +0.080, +0.103의 약한 양의 관계입니다.\n\n관심도 구간별 다음 주 수익률도 단조롭게 증가하거나 감소하지 않습니다. 최근 3년 상위 20% 구간 평균은 +1.34%였지만 60–80 구간은 -0.73%, 최하위 20%는 +1.89%였습니다.\n\n**해석:** 관심도가 높을수록 가격이 오르거나 내린다는 고정 방향 규칙은 없습니다. 기간을 바꾸면 부호가 뒤집히므로 상관계수 하나를 매매 신호로 사용하면 안 됩니다.`,
  },
  { id: "correlation-chart", type: "chart", chartId: "correlation-horizons" },
  {
    id: "rolling-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## 상관은 시장 국면에 따라 계속 바뀝니다\n\n52주 롤링 Spearman 상관은 전체 관측창의 83.0%에서 절대값 0.2 미만이었고, 양수였던 비율도 51.9%에 그쳤습니다. 부호는 44번 바뀌었으며 최고 +0.420, 최저 -0.408, 최신은 -0.077입니다.\n\n**해석:** 장기간 평균 상관보다 ‘현재 관계가 안정적인가’를 먼저 봐야 합니다. 최신 값은 사실상 무상관에 가깝습니다.`,
  },
  { id: "rolling-chart", type: "chart", chartId: "rolling-correlation" },
  {
    id: "volatility-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## 언급량은 방향보다 변동성·활동 강도와 더 가깝습니다\n\n최근 3년 같은 주 Spearman 상관은 실현변동성 0.379, 고저 변동폭 0.371, 거래량 변화 0.240입니다. 주간 수익률과의 동시 상관은 -0.010입니다.\n\n±8주 표에서 관심도가 2–4주 앞선 변동성·고저폭 상관이 약 0.22로 보이지만, 많은 시차와 지표를 동시에 훑은 결과에 별도 다중검정 보정이 적용되지 않았습니다.\n\n**결론:** 언급량은 ‘상승/하락 예측기’보다 ‘시장 관심과 불안이 커지는 상황 표시기’로 사용하는 편이 타당합니다.`,
  },
  {
    id: "contemporaneous-chart",
    type: "chart",
    chartId: "contemporaneous-relationship",
  },
  { id: "lead-lag-table", type: "table", tableId: "lead-lag-results" },
  {
    id: "event-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## 급증 사건 뒤 4주 반등 패턴은 흥미롭지만 아직 잠정적입니다\n\n전체 기간 급증 사건은 +4주 20건, +8주 15건입니다. 중앙수익률은 각각 +16.0%, +23.2%로 전체 주 기준선 +2.1%, +5.7%보다 높았습니다. 그러나 최근 3년은 각각 6건과 5건뿐이며 +4주 +12.2%, +8주 +5.1%로 장기 결과가 그대로 반복되지 않았습니다.\n\n위험도 작지 않습니다. 전체 기간 중앙 최대 불리 움직임(MAE)은 +4주 -8.9%, +8주 -14.5%였습니다. 최근 3년 +1주는 중앙 -0.34%, 상승률 44.4%로 단기 추격에는 불리했습니다.\n\n**해석:** 급증은 큰 가격 움직임이나 충격 뒤 반등 구간과 겹칠 가능성이 있습니다. 4주 패턴은 추가 검증 대상으로 유지하되, 사건 수익률과 동일 시장 국면의 대조군 차이를 직접 검정하기 전에는 진입 규칙으로 쓰지 않아야 합니다.`,
  },
  { id: "event-table", type: "table", tableId: "event-results" },
  {
    id: "top-hypothesis",
    type: "markdown",
    sourceId: source.id,
    body: `## 사용자 가설 검증: 초대형 고점권 급증은 추격 금지 경보로 유효합니다\n\n사건 선택 오류를 수정했습니다. **고점권**은 종가가 직전 26주 최고 종가의 10% 이내, **초대형 급증**은 95백분위와 별개로 언급량이 직전 52주 중앙값보다 10건 이상 많은 주입니다. 조건 충족 주가 2주 이하 간격으로 이어지면 한 사건으로 묶고, 첫 주가 아니라 언급량 최고점을 대표일로 선택했습니다.\n\n수정된 초대형 사건은 2017년 12월 4일, 2021년 1월 4일·2월 15일·4월 12일, 2024년 3월 11일·11월 18일, 2025년 10월 6일의 7건입니다. 4주 뒤 하락 마감은 5건(71.4%), 중앙수익률은 -3.0%였습니다. 더 중요한 경로 위험은 4주 내 -10% 이상 낙폭이 6건(85.7%), 중앙 최대낙폭이 -22.1%였다는 점입니다. 12주 중앙수익률은 -19.2%, 중앙 최대낙폭은 -25.2%였습니다.\n\n넓은 상대적 급증은 다릅니다. 수정된 고점권 일반 급증 15건은 12주 상승 마감 66.7%, 중앙수익률 +20.3%, 중앙 최대상승 +46.4%였습니다. 따라서 단순히 평소보다 많다는 이유만으로 매수를 금지하면 안 되고, **절대 증가폭이 중앙값보다 10건 이상인 초대형 사건**을 별도로 구분해야 합니다.\n\n**판정:** 사용자의 가설은 초대형 고점권 사건에서 뚜렷하게 나타납니다. 다만 7건의 탐색 표본이므로 확정 매도 신호가 아니라 추격 매수·불타기·피라미딩을 중단하고 위험을 재점검하는 경보로 해석해야 합니다.`,
  },
  {
    id: "top-risk-metrics",
    type: "metric-strip",
    cardIds: [
      "broad-high-zone-result",
      "broad-upside-risk",
      "extreme-high-zone-result",
      "extreme-path-result",
    ],
  },
  { id: "top-risk-chart", type: "chart", chartId: "spike-risk-comparison" },
  {
    id: "no-short-interpretation",
    type: "markdown",
    sourceId: source.id,
    body: `## 왜 즉시 숏 신호가 아니라 ‘추격 중단·위험 재점검’ 신호인가\n\n넓은 고점권 급증 15건의 향후 12주 중앙 최대상승은 +46.4%였고, 최대 가격이 나타난 시점의 중앙값은 사건 후 9주였습니다. 최초 ±10% 움직임이 하락이었던 비율도 40%였습니다. 일반 급증 직후 곧바로 하락에 베팅하면 추세 연장에 크게 노출됩니다.\n\n초대형 고점권 7건은 최초 ±10% 움직임이 하락이었던 비율이 71.4%로 위험이 분명히 커졌습니다. 그러나 2017년 12월 사건은 이후 최대 +30.1% 상승한 뒤 하락했고, 2021년 1월 사건은 12주 안에 최대 +61.9%까지 상승했습니다. 고점의 정확한 끝은 식별하지 못합니다.\n\n**실무 해석:** 초대형 고점권 급증이 뜨면 신규 불타기와 피라미딩을 보류하고, 레버리지·손절선·익절 계획을 재검토하는 것은 데이터와 부합합니다. 기존 비중 축소는 개인의 위험 한도와 별도 추세 둔화 신호를 함께 본 조건부 결정이어야 하며, 자동 숏·전량 매도로 확대하면 안 됩니다.`,
  },
  { id: "extreme-events-table", type: "table", tableId: "extreme-spike-events" },
  {
    id: "threshold-sensitivity",
    type: "markdown",
    sourceId: source.id,
    body: `## +9~+20건에서도 하락 경향은 유지되지만 +10건은 탐색 기준입니다\n\n중앙값 대비 +5건으로 낮추면 사건은 13건으로 늘고 12주 중앙수익률은 +1.9%, 엄격한 고점 위험 충족률은 23.1%로 약해집니다. +9건과 +10건은 같은 7건이며 중앙수익률 -19.2%, -10% 이상 낙폭 경험률 85.7%입니다. +15건과 +20건은 6건으로 줄지만 중앙수익률 -10.6%, -10% 낙폭 경험률 83.3%로 방향은 유지됩니다.\n\n따라서 결과가 +10건 한 점에만 의존하지는 않습니다. 다만 +10건은 사용자 가설을 점검하면서 정한 **탐색 기준**이므로, 앞으로는 값을 고정하고 새 사건에서만 성능을 확인해야 과최적화를 줄일 수 있습니다.`,
  },
  {
    id: "extreme-sensitivity-table",
    type: "table",
    tableId: "extreme-spike-sensitivity",
  },
  {
    id: "regime-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## 시장 체제를 나눠도 방향 예측력은 살아나지 않습니다\n\n최근 3년 Spearman 상관은 상승 추세 -0.113, 하락 추세 -0.019, 고변동성 -0.063, 저변동성 -0.067입니다. 전체 기간에는 +0.021~+0.102로 약한 양수지만 최근 구간과 부호가 다릅니다.\n\n**결론:** 추세·변동성 체제 구분이 언급량의 안정적인 방향 예측력을 만들어 주지는 않습니다. 체제는 결과 설명용 보조 문맥이지 신호 강화 장치가 아닙니다.`,
  },
  { id: "regime-table", type: "table", tableId: "regime-results" },
  {
    id: "granger-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## Granger 검정에서도 통계적 선행성은 확인되지 않았습니다\n\n관심 → 수익률 1–4주의 FDR q값은 모두 0.792입니다. 수익률 → 관심은 가장 낮은 q값도 0.415로 0.05 기준을 크게 웃돕니다.\n\n**해석:** 과거 언급량 변화가 과거 수익률만 쓴 모형에 유의한 추가 설명력을 제공한다는 증거가 없습니다. 반대 방향도 마찬가지입니다. 다만 현재 계산에는 진행 중인 2026년 8월 24일 주가 포함되어 있어 주 마감 후 소폭 변할 수 있으며, log1p 변환은 과산포 카운트 자체를 직접 모형화하지 않습니다.`,
  },
  { id: "granger-table", type: "table", tableId: "granger-results" },
  {
    id: "walk-forward-finding",
    type: "markdown",
    sourceId: source.id,
    body: `## 실제 예측 환경에서는 과거 평균을 거의 이기지 못했습니다\n\n최초 104개 관측 이후 매주 과거 데이터만으로 다시 학습한 선형모형의 표본외 R²는 0.001, 방향 적중률은 52.4%(416건)입니다. R² 0.001은 과거 평균 대비 예측오차 감소가 약 0.1%에 불과하다는 뜻입니다. 거래비용·슬리피지·신호 지연도 반영하지 않았습니다.\n\n**최종 판정:** 현재 언급량 단독 모델은 매매 예측기로 사용할 수준이 아닙니다.`,
  },
  {
    id: "recommendations",
    type: "markdown",
    body: `## 권장 운용 규칙과 다음 개선\n\n1. **일반 급증은 자동 매수 금지로 쓰지 않습니다.** 고점권 상대적 급증 15건의 12주 상승률이 66.7%, 중앙수익률이 +20.3%였으므로 약한 급증까지 막으면 추세 상승을 놓칠 수 있습니다.\n2. **‘고점권 + 초대형 급증’을 별도 노란 경보로 둡니다.** 완료 주 기준, 직전 26주 고점의 10% 이내이며 언급량이 52주 중앙값보다 10건 이상 많을 때 신규 불타기·피라미딩을 보류하고 위험 한도를 재검토합니다. 95백분위 충족은 요구하지 않습니다.\n3. **연속 급증은 최고 언급량 주로 판정합니다.** 조건 충족 주가 2주 이하 간격으로 이어지면 같은 사건으로 묶고 첫 주가 아닌 최고점을 대표일로 사용합니다.\n4. **+10건 기준을 최소 20개 사건이 쌓일 때까지 고정합니다.** 현재 7건이므로 매 사건의 4·8·12·26주 경로를 누적하되 결과에 맞춰 임계값을 다시 조정하지 않습니다.\n5. **자동 숏·전량 매도는 하지 않습니다.** 가격 모멘텀 둔화나 추세 이탈 같은 별도 확인 신호가 있을 때만 비중 축소를 검토합니다.`,
  },
  {
    id: "further-questions",
    type: "markdown",
    body: `## 추가로 확인해야 할 질문\n\n- 초대형 급증의 당일·익일 경로를 일 단위로 보면 피라미딩 보류 시점이 주 마감보다 빨라지는가?\n- 네이버·다음 또는 개별 카페 중 어느 소스가 초대형 급증을 주도하는가?\n- 공포·손실·매수·매도·수익 인증 같은 주제 중 고점 위험을 구분하는 조합이 있는가?\n- 앞으로 발생하는 초대형 고점권 사건도 최대상승 제한과 큰 낙폭을 반복하는가?`,
  },
  {
    id: "caveats",
    type: "markdown",
    sourceId: source.id,
    body: `## 전제와 한계\n\n- **데이터 품질 판정: 조건부 공유 가능.** 547개 주는 중복 없이 7일 간격으로 정렬되어 있고 완료 546주의 가격·OHLCV 결측은 0건이며 현재 수집 실패도 0건입니다.\n- 공개 검색 결과는 카페 전체 게시물의 완전한 전수조사가 아니며 플랫폼 검색 색인·노출 정책 변화의 영향을 받을 수 있습니다.\n- 과거 카페별 집계와 원문이 없어 소스 구성 변화, 감성, 주제, 확산도는 검증할 수 없습니다.\n- 초대형 고점권 사건은 7건입니다. 한 사건이 달라질 때 비율이 14.3%p 움직이므로 통계적 확증이 아니라 탐색 결과입니다.\n- +10건과 2주 연결 기준은 이 가설을 점검하면서 정했습니다. 향후에는 고정한 뒤 새 사건에서만 검증해야 선택 편향을 줄일 수 있습니다.\n- 사건 간 시장 국면과 BTC 장기 상승 추세가 다르므로 단순 사건 수익률은 인과관계나 거래 수익성을 증명하지 않습니다.\n- 현재 주(2026년 8월 24일)는 진행 중입니다. 헤드라인·분포와 이번 고점 가설에서는 제외했지만 사전 계산된 Granger 구간에는 포함되어 있습니다.`,
  },
];

const artifact = {
  surface: "report",
  manifest: {
    version: 1,
    surface: "report",
    title: "맘카페 언급량 × 비트코인 분석 해석 보고서",
    description:
      "저빈도 맘카페 언급량과 BTC 시장 반응의 결과별 해석 및 활용 한계",
    generatedAt,
    blocks,
    cards,
    charts,
    tables,
    sources: [source],
  },
  snapshot: {
    version: 1,
    generatedAt,
    status: "ready",
    datasets,
  },
  sources: [source],
};

fs.writeFileSync(
  artifactPath,
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
console.log(artifactPath);
