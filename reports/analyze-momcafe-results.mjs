import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  enrichSeries,
  eventStudy,
  laggedReturns,
  leadLagMatrix,
  median,
  pearson,
  regimeAnalysis,
  rollingCorrelations,
  spearman,
  walkForwardValidation,
} from "../lib/statistics.ts";

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(reportDir);
const snapshotPath = path.join(rootDir, "public", "data.json");
const outputPath = path.join(reportDir, "analysis-results.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

const round = (value, digits = 6) =>
  value === null || value === undefined
    ? null
    : Number(Number(value).toFixed(digits));

const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const quantile = (values, probability) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return (
    ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
  );
};

const summarizeCounts = (points) => {
  const values = points.map((point) => point.postCount);
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return {
    weeks: values.length,
    totalPosts: values.reduce((sum, value) => sum + value, 0),
    mean: round(average),
    variance: round(variance),
    varianceToMean: round(variance / average),
    median: round(median(values)),
    zeroWeeks: values.filter((value) => value === 0).length,
    zeroRatePct: round(
      (values.filter((value) => value === 0).length / values.length) * 100,
    ),
    zeroOrOneWeeks: values.filter((value) => value <= 1).length,
    zeroOrOneRatePct: round(
      (values.filter((value) => value <= 1).length / values.length) * 100,
    ),
    distinctCounts: new Set(values).size,
    min: Math.min(...values),
    p10: round(quantile(values, 0.1)),
    p25: round(quantile(values, 0.25)),
    p50: round(quantile(values, 0.5)),
    p75: round(quantile(values, 0.75)),
    p90: round(quantile(values, 0.9)),
    p95: round(quantile(values, 0.95)),
    p99: round(quantile(values, 0.99)),
    max: Math.max(...values),
  };
};

const distributionBins = (points) => {
  const bins = [
    ["0건", (value) => value === 0],
    ["1건", (value) => value === 1],
    ["2건", (value) => value === 2],
    ["3–4건", (value) => value >= 3 && value <= 4],
    ["5–9건", (value) => value >= 5 && value <= 9],
    ["10–19건", (value) => value >= 10 && value <= 19],
    ["20–39건", (value) => value >= 20 && value <= 39],
    ["40건 이상", (value) => value >= 40],
  ];
  return bins.map(([bin, matches], rank) => {
    const weeks = points.filter((point) => matches(point.postCount)).length;
    return {
      bin,
      weeks,
      sharePct: round((weeks / points.length) * 100, 2),
      rank,
    };
  });
};

const correlationByHorizon = (series, scope) =>
  [1, 2, 4, 8].map((horizon) => {
    const rows = laggedReturns(series, horizon);
    const pairs = rows.map((row) => [row.attentionPercentile, row.returnPct]);
    return {
      scope,
      horizonWeeks: horizon,
      observations: rows.length,
      pearson: round(pearson(pairs)),
      spearman: round(spearman(pairs)),
      medianReturnPct: round(median(rows.map((row) => row.returnPct))),
    };
  });

const attentionBuckets = (series, scope) => {
  const rows = laggedReturns(series, 1);
  const buckets = [
    ["0–20", 0, 20],
    ["20–40", 20, 40],
    ["40–60", 40, 60],
    ["60–80", 60, 80],
    ["80–100", 80, 101],
  ];
  return buckets.map(([bucket, lower, upper], rank) => {
    const values = rows
      .filter(
        (row) =>
          row.attentionPercentile >= lower && row.attentionPercentile < upper,
      )
      .map((row) => row.returnPct);
    return {
      scope,
      bucket,
      rank,
      observations: values.length,
      meanReturnPct: round(mean(values)),
      medianReturnPct: round(median(values)),
      hitRatePct: round(
        values.length
          ? (values.filter((value) => value > 0).length / values.length) * 100
          : null,
      ),
    };
  });
};

const summarizeLeadLag = (series, scope) => {
  const labels = {
    return: "주간 수익률",
    absoluteReturn: "절대 수익률",
    volumeChange: "거래량 변화",
    volatility: "실현변동성",
    range: "고저 변동폭",
  };
  const cells = leadLagMatrix(series);
  return Object.keys(labels).map((outcome) => {
    const rows = cells.filter(
      (cell) => cell.outcome === outcome && cell.spearman !== null,
    );
    const strongest = [...rows].sort(
      (left, right) => Math.abs(right.spearman) - Math.abs(left.spearman),
    )[0];
    const attentionLeads = [...rows]
      .filter((row) => row.lag > 0)
      .sort(
        (left, right) => Math.abs(right.spearman) - Math.abs(left.spearman),
      )[0];
    const marketLeads = [...rows]
      .filter((row) => row.lag < 0)
      .sort(
        (left, right) => Math.abs(right.spearman) - Math.abs(left.spearman),
      )[0];
    const contemporaneous = rows.find((row) => row.lag === 0);
    return {
      scope,
      outcome,
      label: labels[outcome],
      strongestLag: strongest.lag,
      strongestSpearman: round(strongest.spearman),
      strongestN: strongest.observations,
      contemporaneousSpearman: round(contemporaneous?.spearman),
      attentionLeadLag: attentionLeads?.lag ?? null,
      attentionLeadSpearman: round(attentionLeads?.spearman),
      marketLeadLag: marketLeads?.lag ?? null,
      marketLeadSpearman: round(marketLeads?.spearman),
    };
  });
};

const summarizeRolling = (series, scope) => {
  const rows = rollingCorrelations(series).filter(
    (row) => row.spearman !== null,
  );
  const values = rows.map((row) => row.spearman);
  let signChanges = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Math.sign(values[index]) !== Math.sign(values[index - 1]))
      signChanges += 1;
  }
  const minimum = [...rows].sort((a, b) => a.spearman - b.spearman)[0];
  const maximum = [...rows].sort((a, b) => b.spearman - a.spearman)[0];
  const latest = rows.at(-1);
  return {
    scope,
    windows: rows.length,
    latestWeek: latest?.week ?? null,
    latestSpearman: round(latest?.spearman),
    minimumWeek: minimum?.week ?? null,
    minimumSpearman: round(minimum?.spearman),
    maximumWeek: maximum?.week ?? null,
    maximumSpearman: round(maximum?.spearman),
    positiveRatePct: round(
      (values.filter((value) => value > 0).length / values.length) * 100,
    ),
    weakRatePct: round(
      (values.filter((value) => Math.abs(value) < 0.2).length / values.length) *
        100,
    ),
    signChanges,
  };
};

const normalizeEvents = (rows, scope, series) =>
  rows.map((row) => {
    const baselineReturns = laggedReturns(series, row.horizon).map(
      (point) => point.returnPct,
    );
    const baselineMedianReturnPct = median(baselineReturns);
    const baselineHitRatePct = baselineReturns.length
      ? (baselineReturns.filter((value) => value > 0).length /
          baselineReturns.length) *
        100
      : null;
    return {
      scope,
      horizonWeeks: row.horizon,
      events: row.events,
      medianReturnPct: round(row.medianReturnPct),
      baselineMedianReturnPct: round(baselineMedianReturnPct),
      medianExcessPct: round(row.medianReturnPct - baselineMedianReturnPct),
      meanReturnPct: round(row.meanReturnPct),
      hitRatePct: round(row.hitRatePct),
      baselineHitRatePct: round(baselineHitRatePct),
      medianMfePct: round(row.medianMfePct),
      medianMaePct: round(row.medianMaePct),
      ciLowPct: round(row.confidenceInterval?.[0]),
      ciHighPct: round(row.confidenceInterval?.[1]),
    };
  });

const normalizeRegimes = (rows, scope) =>
  rows.map((row) => ({
    scope,
    regime: row.regime,
    observations: row.observations,
    pearson: round(row.pearson),
    spearman: round(row.spearman),
    medianNextReturnPct: round(row.medianNextReturnPct),
  }));

const complete = snapshot.series.filter(
  (point) => point.periodStatus === "complete",
);
const analytics = enrichSeries(snapshot.series);
const analyticsComplete = analytics.filter(
  (point) => point.periodStatus === "complete",
);
const last3y = analytics.slice(-156);
const last52Complete = complete.slice(-52);
const latestComplete = analyticsComplete.at(-1);
const latestIndex = analytics.findIndex(
  (point) => point.week === latestComplete.week,
);
const fourWeeksAgo = analytics[latestIndex - 4];

const quality = {
  rows: snapshot.series.length,
  completeWeeks: complete.length,
  inProgressWeeks: snapshot.series.filter(
    (point) => point.periodStatus === "in_progress",
  ).length,
  duplicateWeeks:
    snapshot.series.length -
    new Set(snapshot.series.map((point) => point.week)).size,
  orderedAscending: snapshot.series.every(
    (point, index) =>
      index === 0 || point.week > snapshot.series[index - 1].week,
  ),
  exactWeeklyCadence: snapshot.series.every((point, index) => {
    if (index === 0) return true;
    return (
      (new Date(`${point.week}T00:00:00Z`) -
        new Date(`${snapshot.series[index - 1].week}T00:00:00Z`)) /
        86_400_000 ===
      7
    );
  }),
  negativePostCounts: snapshot.series.filter((point) => point.postCount < 0)
    .length,
  completeWeeksMissingClose: complete.filter((point) => point.btcClose === null)
    .length,
  completeWeeksMissingOhlcv: complete.filter((point) =>
    [point.btcOpen, point.btcHigh, point.btcLow, point.btcVolume].some(
      (value) => value === null,
    ),
  ).length,
  sourceCount: snapshot.collection.posts.sourceCount,
  postPipelineStatus: snapshot.collection.posts.status,
  postPipelineFailures: snapshot.collection.posts.failures.length,
  pricePipelineStatus: snapshot.collection.price.status,
  observedThrough: snapshot.collection.price.observedThrough,
  updatedAt: snapshot.updatedAt,
};

const result = {
  generatedAt: new Date().toISOString(),
  snapshot: {
    updatedAt: snapshot.updatedAt,
    observedThrough: snapshot.collection.price.observedThrough,
    firstWeek: snapshot.series[0].week,
    latestWeek: snapshot.series.at(-1).week,
    latestWeekStatus: snapshot.series.at(-1).periodStatus,
    latestCompleteWeek: latestComplete.week,
  },
  quality,
  countProfiles: {
    completedHistory: summarizeCounts(complete),
    latest3y: summarizeCounts(
      last3y.filter((point) => point.periodStatus === "complete"),
    ),
    latest52Completed: summarizeCounts(last52Complete),
  },
  distribution: distributionBins(complete),
  latestCompleted: {
    week: latestComplete.week,
    postCount: latestComplete.postCount,
    attentionPercentile: round(latestComplete.attentionPercentile),
    attentionBaselineMedian: round(latestComplete.attentionBaselineMedian),
    mentionChange4w: latestComplete.mentionChange4w,
    fourWeeksAgoCount: fourWeeksAgo.postCount,
    btcClose: latestComplete.btcClose,
    nextWeekReturnPct: round(latestComplete.nextWeekReturn * 100),
    realizedVolatilityPct: round(latestComplete.realizedVolatility),
    rangePct: round(latestComplete.rangePct),
  },
  correlations: [
    ...correlationByHorizon(last3y, "최근 3년"),
    ...correlationByHorizon(analytics, "전체 기간"),
  ],
  attentionBuckets: [
    ...attentionBuckets(last3y, "최근 3년"),
    ...attentionBuckets(analytics, "전체 기간"),
  ],
  leadLag: [
    ...summarizeLeadLag(last3y, "최근 3년"),
    ...summarizeLeadLag(analytics, "전체 기간"),
  ],
  events: [
    ...normalizeEvents(eventStudy(last3y), "최근 3년", last3y),
    ...normalizeEvents(eventStudy(analytics), "전체 기간", analytics),
  ],
  rolling: {
    summary: summarizeRolling(analytics, "전체 기간"),
    rows: rollingCorrelations(analytics)
      .filter((row) => row.spearman !== null)
      .map((row) => ({
        week: row.week,
        pearson: round(row.pearson),
        spearman: round(row.spearman),
        observations: row.observations,
      })),
  },
  regimes: [
    ...normalizeRegimes(regimeAnalysis(last3y), "최근 3년"),
    ...normalizeRegimes(regimeAnalysis(analytics), "전체 기간"),
  ],
  granger: snapshot.analysis.granger,
  walkForward: {
    ...walkForwardValidation(analytics),
    oosR2: round(walkForwardValidation(analytics).oosR2),
    directionalAccuracyPct: round(
      walkForwardValidation(analytics).directionalAccuracyPct,
    ),
  },
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(outputPath);
