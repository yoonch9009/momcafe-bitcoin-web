import type { WeeklyPoint } from "@/lib/dashboard-data";

export function pearson(
  values: Array<readonly [number, number]>,
): number | null {
  if (values.length < 3) return null;
  const xMean = values.reduce((sum, [x]) => sum + x, 0) / values.length;
  const yMean = values.reduce((sum, [, y]) => sum + y, 0) / values.length;
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (const [x, y] of values) {
    const dx = x - xMean;
    const dy = y - yMean;
    covariance += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator === 0 ? null : covariance / denominator;
}

function ranks(values: number[]): number[] {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < ordered.length) {
    let end = cursor + 1;
    while (end < ordered.length && ordered[end].value === ordered[cursor].value)
      end += 1;
    const averageRank = (cursor + 1 + end) / 2;
    for (let index = cursor; index < end; index += 1) {
      result[ordered[index].index] = averageRank;
    }
    cursor = end;
  }
  return result;
}

export function spearman(
  values: Array<readonly [number, number]>,
): number | null {
  if (values.length < 3) return null;
  const xRanks = ranks(values.map(([x]) => x));
  const yRanks = ranks(values.map(([, y]) => y));
  return pearson(xRanks.map((x, index) => [x, yRanks[index]] as const));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

export type AnalyticPoint = WeeklyPoint & {
  attentionScore: number | null;
  mentionMomentum4w: number | null;
  weeklyReturnPct: number | null;
  absoluteReturnPct: number | null;
  volumeChangePct: number | null;
  sma26: number | null;
  trendRegime: "bull" | "bear" | null;
  volatilityRegime: "high" | "low" | null;
};

export function enrichSeries(series: WeeklyPoint[]): AnalyticPoint[] {
  return series.map((point, index) => {
    const history = series
      .slice(Math.max(0, index - 52), index)
      .map((item) => Math.log1p(item.postCount));
    const baselineMedian = history.length >= 26 ? median(history) : null;
    const deviations =
      baselineMedian === null
        ? []
        : history.map((value) => Math.abs(value - baselineMedian));
    const mad = median(deviations);
    const attentionScore =
      baselineMedian === null || mad === null || mad === 0
        ? null
        : (0.67448975 * (Math.log1p(point.postCount) - baselineMedian)) / mad;
    const previous = index > 0 ? series[index - 1] : null;
    const fourWeeksAgo = index >= 4 ? series[index - 4] : null;
    const weeklyReturnPct =
      previous?.btcClose && point.btcClose
        ? (point.btcClose / previous.btcClose - 1) * 100
        : null;
    const volumeChangePct =
      previous?.btcVolume && point.btcVolume !== null
        ? (point.btcVolume / previous.btcVolume - 1) * 100
        : null;
    const closes = series
      .slice(Math.max(0, index - 25), index + 1)
      .map((item) => item.btcClose)
      .filter((value): value is number => value !== null);
    const sma26 =
      closes.length === 26
        ? closes.reduce((sum, value) => sum + value, 0) / closes.length
        : null;
    const volatilityHistory = series
      .slice(Math.max(0, index - 52), index)
      .map((item) => item.realizedVolatility)
      .filter((value): value is number => value !== null);
    const volatilityMedian =
      volatilityHistory.length >= 26 ? median(volatilityHistory) : null;
    return {
      ...point,
      attentionScore,
      mentionMomentum4w:
        fourWeeksAgo === null
          ? null
          : ((point.postCount + 1) / (fourWeeksAgo.postCount + 1) - 1) * 100,
      weeklyReturnPct,
      absoluteReturnPct:
        weeklyReturnPct === null ? null : Math.abs(weeklyReturnPct),
      volumeChangePct,
      sma26,
      trendRegime:
        sma26 === null || point.btcClose === null
          ? null
          : point.btcClose >= sma26
            ? "bull"
            : "bear",
      volatilityRegime:
        volatilityMedian === null || point.realizedVolatility === null
          ? null
          : point.realizedVolatility >= volatilityMedian
            ? "high"
            : "low",
    };
  });
}

export type ScatterPoint = { week: string; posts: number; returnPct: number };

export function laggedReturns(
  series: WeeklyPoint[],
  horizon: number,
): ScatterPoint[] {
  const result: ScatterPoint[] = [];
  for (let index = 0; index + horizon < series.length; index += 1) {
    const start = series[index];
    const end = series[index + horizon];
    if (
      start.btcClose === null ||
      end.btcClose === null ||
      start.btcClose === 0
    )
      continue;
    result.push({
      week: start.week,
      posts: start.postCount,
      returnPct: (end.btcClose / start.btcClose - 1) * 100,
    });
  }
  return result;
}

export type LeadLagOutcome =
  "return" | "absoluteReturn" | "volumeChange" | "volatility" | "range";

export type LeadLagCell = {
  outcome: LeadLagOutcome;
  lag: number;
  pearson: number | null;
  spearman: number | null;
  observations: number;
};

function outcomeValue(point: AnalyticPoint, outcome: LeadLagOutcome) {
  if (outcome === "return") return point.weeklyReturnPct;
  if (outcome === "absoluteReturn") return point.absoluteReturnPct;
  if (outcome === "volumeChange") return point.volumeChangePct;
  if (outcome === "volatility") return point.realizedVolatility;
  return point.rangePct;
}

export function leadLagMatrix(
  series: AnalyticPoint[],
  maxLag = 8,
): LeadLagCell[] {
  const outcomes: LeadLagOutcome[] = [
    "return",
    "absoluteReturn",
    "volumeChange",
    "volatility",
    "range",
  ];
  return outcomes.flatMap((outcome) =>
    Array.from({ length: maxLag * 2 + 1 }, (_, offset) => offset - maxLag).map(
      (lag) => {
        const pairs: Array<readonly [number, number]> = [];
        for (let index = 0; index < series.length; index += 1) {
          const target = series[index + lag];
          const attention = series[index].attentionScore;
          const value = target ? outcomeValue(target, outcome) : null;
          if (attention !== null && value !== null)
            pairs.push([attention, value]);
        }
        return {
          outcome,
          lag,
          pearson: pearson(pairs),
          spearman: spearman(pairs),
          observations: pairs.length,
        };
      },
    ),
  );
}

export type RollingCorrelation = {
  week: string;
  pearson: number | null;
  spearman: number | null;
  observations: number;
};

export function rollingCorrelations(
  series: AnalyticPoint[],
  window = 52,
  horizon = 1,
): RollingCorrelation[] {
  const result: RollingCorrelation[] = [];
  for (let end = window - 1; end + horizon < series.length; end += 1) {
    const pairs: Array<readonly [number, number]> = [];
    for (let index = end - window + 1; index <= end; index += 1) {
      const start = series[index];
      const future = series[index + horizon];
      if (
        start.attentionScore === null ||
        start.btcClose === null ||
        future.btcClose === null ||
        start.btcClose === 0
      )
        continue;
      pairs.push([
        start.attentionScore,
        (future.btcClose / start.btcClose - 1) * 100,
      ]);
    }
    result.push({
      week: series[end].week,
      pearson: pearson(pairs),
      spearman: spearman(pairs),
      observations: pairs.length,
    });
  }
  return result;
}

function percentile(values: number[], proportion: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return (
    ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
  );
}

function movingBlockMedianCI(
  values: number[],
  seed: number,
  samples = 1000,
): readonly [number, number] | null {
  if (values.length < 5) return null;
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const blockLength = Math.max(2, Math.ceil(Math.sqrt(values.length)));
  const medians: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const resampled: number[] = [];
    while (resampled.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (
        let offset = 0;
        offset < blockLength && resampled.length < values.length;
        offset += 1
      )
        resampled.push(values[(start + offset) % values.length]);
    }
    medians.push(median(resampled)!);
  }
  return [percentile(medians, 0.025), percentile(medians, 0.975)] as const;
}

export type EventStudyResult = {
  horizon: number;
  events: number;
  medianReturnPct: number | null;
  meanReturnPct: number | null;
  hitRatePct: number | null;
  medianMfePct: number | null;
  medianMaePct: number | null;
  confidenceInterval: readonly [number, number] | null;
};

export function eventStudy(
  series: AnalyticPoint[],
  threshold = 2,
  horizons = [1, 2, 4, 8],
): EventStudyResult[] {
  return horizons.map((horizon) => {
    const returns: number[] = [];
    const mfe: number[] = [];
    const mae: number[] = [];
    for (let index = 0; index + horizon < series.length; index += 1) {
      const start = series[index];
      const end = series[index + horizon];
      if (
        start.attentionScore === null ||
        start.attentionScore < threshold ||
        start.btcExchangeClose === null ||
        start.btcExchangeClose === 0 ||
        end.btcExchangeClose === null
      )
        continue;
      returns.push((end.btcExchangeClose / start.btcExchangeClose - 1) * 100);
      const future = series.slice(index + 1, index + horizon + 1);
      const highs = future
        .map((point) => point.btcHigh)
        .filter((value): value is number => value !== null);
      const lows = future
        .map((point) => point.btcLow)
        .filter((value): value is number => value !== null);
      if (highs.length)
        mfe.push((Math.max(...highs) / start.btcExchangeClose - 1) * 100);
      if (lows.length)
        mae.push((Math.min(...lows) / start.btcExchangeClose - 1) * 100);
    }
    return {
      horizon,
      events: returns.length,
      medianReturnPct: median(returns),
      meanReturnPct: returns.length
        ? returns.reduce((sum, value) => sum + value, 0) / returns.length
        : null,
      hitRatePct: returns.length
        ? (returns.filter((value) => value > 0).length / returns.length) * 100
        : null,
      medianMfePct: median(mfe),
      medianMaePct: median(mae),
      confidenceInterval: movingBlockMedianCI(returns, 20260825 + horizon),
    };
  });
}

export type RegimeResult = {
  regime: string;
  observations: number;
  pearson: number | null;
  spearman: number | null;
  medianNextReturnPct: number | null;
};

export function regimeAnalysis(series: AnalyticPoint[]): RegimeResult[] {
  const definitions = [
    ["상승 추세", (point: AnalyticPoint) => point.trendRegime === "bull"],
    ["하락 추세", (point: AnalyticPoint) => point.trendRegime === "bear"],
    ["고변동성", (point: AnalyticPoint) => point.volatilityRegime === "high"],
    ["저변동성", (point: AnalyticPoint) => point.volatilityRegime === "low"],
  ] as const;
  return definitions.map(([regime, matches]) => {
    const pairs: Array<readonly [number, number]> = [];
    for (let index = 0; index + 1 < series.length; index += 1) {
      const point = series[index];
      const future = series[index + 1];
      if (
        !matches(point) ||
        point.attentionScore === null ||
        point.btcClose === null ||
        point.btcClose === 0 ||
        future.btcClose === null
      )
        continue;
      pairs.push([
        point.attentionScore,
        (future.btcClose / point.btcClose - 1) * 100,
      ]);
    }
    return {
      regime,
      observations: pairs.length,
      pearson: pearson(pairs),
      spearman: spearman(pairs),
      medianNextReturnPct: median(pairs.map(([, value]) => value)),
    };
  });
}

export type WalkForwardResult = {
  observations: number;
  oosR2: number | null;
  directionalAccuracyPct: number | null;
};

export function walkForwardValidation(
  series: AnalyticPoint[],
  minimumTraining = 104,
): WalkForwardResult {
  const observations: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < series.length; index += 1) {
    const point = series[index];
    const future = series[index + 1];
    if (
      point.attentionScore !== null &&
      point.btcClose !== null &&
      point.btcClose !== 0 &&
      future.btcClose !== null
    )
      observations.push({
        x: point.attentionScore,
        y: (future.btcClose / point.btcClose - 1) * 100,
      });
  }
  let squaredError = 0;
  let benchmarkError = 0;
  let correctDirection = 0;
  let tested = 0;
  for (let index = minimumTraining; index < observations.length; index += 1) {
    const training = observations.slice(0, index);
    const xMean =
      training.reduce((sum, item) => sum + item.x, 0) / training.length;
    const yMean =
      training.reduce((sum, item) => sum + item.y, 0) / training.length;
    const denominator = training.reduce(
      (sum, item) => sum + (item.x - xMean) ** 2,
      0,
    );
    const slope =
      denominator === 0
        ? 0
        : training.reduce(
            (sum, item) => sum + (item.x - xMean) * (item.y - yMean),
            0,
          ) / denominator;
    const prediction = yMean + slope * (observations[index].x - xMean);
    const actual = observations[index].y;
    squaredError += (actual - prediction) ** 2;
    benchmarkError += (actual - yMean) ** 2;
    if (prediction >= 0 === actual >= 0) correctDirection += 1;
    tested += 1;
  }
  return {
    observations: tested,
    oosR2:
      tested && benchmarkError > 0 ? 1 - squaredError / benchmarkError : null,
    directionalAccuracyPct: tested ? (correctDirection / tested) * 100 : null,
  };
}

export function relativeChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}
