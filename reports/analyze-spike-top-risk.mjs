import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { enrichSeries, median } from "../lib/statistics.ts";

const reportDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(reportDir);
const snapshot = JSON.parse(
  fs.readFileSync(path.join(rootDir, "public", "data.json"), "utf8"),
);
const outputPath = path.join(reportDir, "spike-top-risk-results.json");

const round = (value, digits = 6) =>
  value === null || value === undefined
    ? null
    : Number(Number(value).toFixed(digits));

const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const percentile = (values, probability) => {
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

const complete = snapshot.series.filter(
  (point) => point.periodStatus === "complete",
);
const series = enrichSeries(complete);

const previousHigh = (index, window = 26) => {
  const closes = series
    .slice(Math.max(0, index - window), index)
    .map((point) => point.btcExchangeClose)
    .filter((value) => value !== null);
  return closes.length === window ? Math.max(...closes) : null;
};

const forwardOutcome = (index, horizon) => {
  const entry = series[index].btcExchangeClose;
  const end = series[index + horizon]?.btcExchangeClose;
  const future = series.slice(index + 1, index + horizon + 1);
  if (entry === null || end === null || future.length !== horizon) return null;
  const highs = future
    .map((point) => point.btcHigh)
    .filter((value) => value !== null);
  const lows = future
    .map((point) => point.btcLow)
    .filter((value) => value !== null);
  if (highs.length !== horizon || lows.length !== horizon) return null;
  const maximumHigh = Math.max(...highs);
  const minimumLow = Math.min(...lows);
  const maximumHighOffset = highs.indexOf(maximumHigh) + 1;
  let firstTenPercentMove = "none";
  for (let offset = 0; offset < horizon; offset += 1) {
    const hitUp = highs[offset] >= entry * 1.1;
    const hitDown = lows[offset] <= entry * 0.9;
    if (hitUp && hitDown) {
      firstTenPercentMove = "same_week";
      break;
    }
    if (hitUp) {
      firstTenPercentMove = "up";
      break;
    }
    if (hitDown) {
      firstTenPercentMove = "down";
      break;
    }
  }
  const maxUpsidePct = (maximumHigh / entry - 1) * 100;
  const maxDrawdownPct = (minimumLow / entry - 1) * 100;
  return {
    terminalReturnPct: (end / entry - 1) * 100,
    maxUpsidePct,
    maxDrawdownPct,
    weeksToMaximumHigh: maximumHighOffset,
    upsideWithin10Pct: maxUpsidePct <= 10,
    drawdown10: maxDrawdownPct <= -10,
    drawdown20: maxDrawdownPct <= -20,
    topRisk: maxUpsidePct <= 10 && maxDrawdownPct <= -10,
    firstTenPercentMove,
  };
};

const deduplicate = (indexes, cooldown) => {
  const selected = [];
  for (const index of indexes) {
    if (!selected.length || index - selected.at(-1) > cooldown)
      selected.push(index);
  }
  return selected;
};

const selectEpisodePeaks = (indexes, maximumGapWeeks = 2) => {
  const groups = [];
  for (const index of indexes) {
    const latestGroup = groups.at(-1);
    if (
      !latestGroup ||
      index - latestGroup.at(-1) > maximumGapWeeks
    ) {
      groups.push([index]);
    } else {
      latestGroup.push(index);
    }
  }
  return groups.map((group) =>
    group.reduce((peakIndex, index) =>
      series[index].postCount > series[peakIndex].postCount
        ? index
        : peakIndex,
    ),
  );
};

const rawSpikeIndexes = series
  .map((point, index) => (point.isAttentionSpike ? index : null))
  .filter((index) => index !== null);

const episodeIndexes = deduplicate(rawSpikeIndexes, 8);

const contextFor = (index, nearHighThresholdPct = 10) => {
  const high = previousHigh(index, 26);
  const close = series[index].btcExchangeClose;
  if (high === null || close === null) return null;
  const distanceFromPriorHighPct = (close / high - 1) * 100;
  return {
    prior26WeekHigh: high,
    distanceFromPriorHighPct,
    nearHigh: distanceFromPriorHighPct >= -nearHighThresholdPct,
    panic:
      (series[index].weeklyReturnPct ?? 0) <= -5 ||
      distanceFromPriorHighPct < -15,
  };
};

const panicIndexes = episodeIndexes.filter((index) => contextFor(index, 10)?.panic);
const mentionExcess = (index) =>
  series[index].attentionBaselineMedian === null
    ? null
    : series[index].postCount - series[index].attentionBaselineMedian;
const highZoneCandidateWeekIndexes = rawSpikeIndexes.filter(
  (index) => contextFor(index, 10)?.nearHigh,
);
const highZoneIndexes = selectEpisodePeaks(highZoneCandidateWeekIndexes, 2);
const extremeHighZoneCandidateWeekIndexes = series
  .map((_, index) =>
    (mentionExcess(index) ?? -Infinity) >= 10 &&
    contextFor(index, 10)?.nearHigh
      ? index
      : null,
  )
  .filter((index) => index !== null);
const extremeHighZoneIndexes = selectEpisodePeaks(
  extremeHighZoneCandidateWeekIndexes,
  2,
);

const summarize = (indexes, horizon, cohort) => {
  const outcomes = indexes
    .map((index) => ({ index, outcome: forwardOutcome(index, horizon) }))
    .filter((item) => item.outcome !== null);
  const values = (field) => outcomes.map((item) => item.outcome[field]);
  const count = (field) => outcomes.filter((item) => item.outcome[field]).length;
  const firstMoveKnown = outcomes.filter(
    (item) => item.outcome.firstTenPercentMove !== "none",
  );
  return {
    cohort,
    horizonWeeks: horizon,
    events: outcomes.length,
    medianReturnPct: round(median(values("terminalReturnPct"))),
    meanReturnPct: round(mean(values("terminalReturnPct"))),
    positiveReturnRatePct: round(
      outcomes.length
        ? (values("terminalReturnPct").filter((value) => value > 0).length /
            outcomes.length) *
            100
        : null,
    ),
    p25ReturnPct: round(percentile(values("terminalReturnPct"), 0.25)),
    p10ReturnPct: round(percentile(values("terminalReturnPct"), 0.1)),
    medianMaxUpsidePct: round(median(values("maxUpsidePct"))),
    medianMaxDrawdownPct: round(median(values("maxDrawdownPct"))),
    drawdown10RatePct: round(
      outcomes.length ? (count("drawdown10") / outcomes.length) * 100 : null,
    ),
    drawdown20RatePct: round(
      outcomes.length ? (count("drawdown20") / outcomes.length) * 100 : null,
    ),
    upsideWithin10RatePct: round(
      outcomes.length
        ? (count("upsideWithin10Pct") / outcomes.length) * 100
        : null,
    ),
    topRiskRatePct: round(
      outcomes.length ? (count("topRisk") / outcomes.length) * 100 : null,
    ),
    medianWeeksToMaximumHigh: round(median(values("weeksToMaximumHigh"))),
    firstDown10RatePct: round(
      firstMoveKnown.length
        ? (firstMoveKnown.filter(
            (item) => item.outcome.firstTenPercentMove === "down",
          ).length /
            firstMoveKnown.length) *
            100
        : null,
    ),
    firstMoveKnown: firstMoveKnown.length,
  };
};

const matchedControls = (eventIndexes, horizon, nearHighThresholdPct = 10) => {
  const spikeSet = new Set(rawSpikeIndexes);
  const used = new Set();
  const candidates = series
    .map((point, index) => ({ point, index, context: contextFor(index, nearHighThresholdPct) }))
    .filter(({ index, context }) => {
      if (!context?.nearHigh || spikeSet.has(index) || index + horizon >= series.length)
        return false;
      return !rawSpikeIndexes.some((spikeIndex) => Math.abs(spikeIndex - index) <= 8);
    });

  const pairs = [];
  for (const eventIndex of eventIndexes) {
    if (eventIndex + horizon >= series.length) continue;
    const event = series[eventIndex];
    const available = candidates.filter(
      ({ point, index }) =>
        !used.has(index) &&
        point.trendRegime === event.trendRegime &&
        point.volatilityRegime === event.volatilityRegime,
    );
    if (!available.length) continue;
    available.sort((left, right) => {
      const leftScore =
        Math.abs(left.index - eventIndex) +
        Math.abs(
          (left.point.weeklyReturnPct ?? 0) - (event.weeklyReturnPct ?? 0),
        ) *
          2;
      const rightScore =
        Math.abs(right.index - eventIndex) +
        Math.abs(
          (right.point.weeklyReturnPct ?? 0) - (event.weeklyReturnPct ?? 0),
        ) *
          2;
      return leftScore - rightScore;
    });
    const controlIndex = available[0].index;
    used.add(controlIndex);
    pairs.push({
      eventIndex,
      controlIndex,
      event: forwardOutcome(eventIndex, horizon),
      control: forwardOutcome(controlIndex, horizon),
    });
  }
  return pairs.filter((pair) => pair.event !== null && pair.control !== null);
};

const signFlipPValue = (differences) => {
  if (!differences.length || differences.length > 20) return null;
  const observed = Math.abs(mean(differences));
  const combinations = 2 ** differences.length;
  let atLeastAsExtreme = 0;
  for (let mask = 0; mask < combinations; mask += 1) {
    const value = mean(
      differences.map((difference, index) =>
        mask & (1 << index) ? difference : -difference,
      ),
    );
    if (Math.abs(value) >= observed - 1e-12) atLeastAsExtreme += 1;
  }
  return atLeastAsExtreme / combinations;
};

const pairedSummary = (horizon) => {
  const pairs = matchedControls(highZoneIndexes, horizon);
  const eventReturns = pairs.map((pair) => pair.event.terminalReturnPct);
  const controlReturns = pairs.map((pair) => pair.control.terminalReturnPct);
  const eventDrawdowns = pairs.map((pair) => pair.event.maxDrawdownPct);
  const controlDrawdowns = pairs.map((pair) => pair.control.maxDrawdownPct);
  const returnDifferences = pairs.map(
    (pair) => pair.event.terminalReturnPct - pair.control.terminalReturnPct,
  );
  const drawdownDifferences = pairs.map(
    (pair) => pair.event.maxDrawdownPct - pair.control.maxDrawdownPct,
  );
  return {
    horizonWeeks: horizon,
    pairs: pairs.length,
    eventMedianReturnPct: round(median(eventReturns)),
    controlMedianReturnPct: round(median(controlReturns)),
    medianReturnDifferencePct: round(median(returnDifferences)),
    meanReturnDifferencePct: round(mean(returnDifferences)),
    returnDifferencePValue: round(signFlipPValue(returnDifferences)),
    eventMedianMaxDrawdownPct: round(median(eventDrawdowns)),
    controlMedianMaxDrawdownPct: round(median(controlDrawdowns)),
    medianDrawdownDifferencePct: round(median(drawdownDifferences)),
    drawdownDifferencePValue: round(signFlipPValue(drawdownDifferences)),
    eventDrawdown10Count: pairs.filter((pair) => pair.event.drawdown10).length,
    controlDrawdown10Count: pairs.filter((pair) => pair.control.drawdown10).length,
    pairRows: pairs.map((pair) => ({
      eventWeek: series[pair.eventIndex].week,
      controlWeek: series[pair.controlIndex].week,
      eventReturnPct: round(pair.event.terminalReturnPct),
      controlReturnPct: round(pair.control.terminalReturnPct),
      eventMaxDrawdownPct: round(pair.event.maxDrawdownPct),
      controlMaxDrawdownPct: round(pair.control.maxDrawdownPct),
    })),
  };
};

const sensitivity = [];
for (const thresholdPct of [5, 10, 15]) {
  for (const maximumGapWeeks of [1, 2, 3]) {
    const indexes = selectEpisodePeaks(
      rawSpikeIndexes.filter(
        (index) => contextFor(index, thresholdPct)?.nearHigh,
      ),
      maximumGapWeeks,
    );
    sensitivity.push({
      thresholdPct,
      maximumGapWeeks,
      ...summarize(indexes, 12, "고점권 스파이크"),
    });
  }
}

const sensitivityEpisodePeaks = selectEpisodePeaks(
  series
    .map((_, index) =>
      (mentionExcess(index) ?? -Infinity) >= 5 &&
      contextFor(index, 10)?.nearHigh
        ? index
        : null,
    )
    .filter((index) => index !== null),
  2,
);

const extremeSensitivity = [5, 9, 10, 15, 20].map((excessThreshold) => {
  const indexes = sensitivityEpisodePeaks.filter(
    (index) => (mentionExcess(index) ?? -Infinity) >= excessThreshold,
  );
  return {
    excessThreshold,
    ...summarize(indexes, 12, "고점권 초대형 스파이크"),
  };
});

const eventIndexes = [
  ...new Set([
    ...episodeIndexes,
    ...highZoneIndexes,
    ...extremeHighZoneIndexes,
  ]),
].sort((left, right) => left - right);

const eventRows = eventIndexes.map((index) => {
  const point = series[index];
  const context = contextFor(index, 10);
  const outcome4 = forwardOutcome(index, 4);
  const outcome8 = forwardOutcome(index, 8);
  const outcome12 = forwardOutcome(index, 12);
  return {
    week: point.week,
    postCount: point.postCount,
    baselineMedian: round(point.attentionBaselineMedian),
    mentionExcess: round(mentionExcess(index)),
    attentionPercentile: round(point.attentionPercentile),
    btcClose: round(point.btcExchangeClose, 2),
    weeklyReturnPct: round(point.weeklyReturnPct),
    distanceFromPriorHighPct: round(context?.distanceFromPriorHighPct),
    context:
      context?.nearHigh === true
        ? "고점권"
        : context?.panic === true
          ? "패닉/저점권"
          : "중간권",
    return4wPct: round(outcome4?.terminalReturnPct),
    maxDrawdown4wPct: round(outcome4?.maxDrawdownPct),
    return8wPct: round(outcome8?.terminalReturnPct),
    maxDrawdown8wPct: round(outcome8?.maxDrawdownPct),
    return12wPct: round(outcome12?.terminalReturnPct),
    maxUpside12wPct: round(outcome12?.maxUpsidePct),
    maxDrawdown12wPct: round(outcome12?.maxDrawdownPct),
    topRisk12w: outcome12?.topRisk ?? null,
    isHighZoneEpisodePeak: highZoneIndexes.includes(index),
    isExtremeHighZoneEpisodePeak: extremeHighZoneIndexes.includes(index),
  };
});

const referencePeakWeeks = [
  "2017-12-04",
  "2021-01-04",
  "2021-02-15",
  "2021-04-12",
  "2024-03-11",
  "2024-11-18",
  "2025-10-06",
];
const selectedExtremePeakWeeks = extremeHighZoneIndexes.map(
  (index) => series[index].week,
);
const missingReferencePeakWeeks = referencePeakWeeks.filter(
  (week) => !selectedExtremePeakWeeks.includes(week),
);
if (missingReferencePeakWeeks.length) {
  throw new Error(
    `Corrected extreme-spike selection lost reference peaks: ${missingReferencePeakWeeks.join(", ")}`,
  );
}

const result = {
  generatedAt: new Date().toISOString(),
  asOf: snapshot.collection.price.observedThrough,
  definitions: {
    spike:
      "직전 52주 95백분위 이상이면서 직전 52주 중앙값보다 최소 3건 많은 주",
    episode: "첫 스파이크 후 8주 이내 추가 스파이크는 같은 에피소드로 처리",
    topRiskEpisode:
      "조건 충족 주가 2주 이하 간격으로 이어지면 한 사건으로 묶고 언급량 최고점을 대표일로 선택",
    nearHigh:
      "스파이크 주 종가가 직전 26주 최고 종가의 10% 이내인 경우",
    extremeSpike:
      "95백분위 조건과 별개로 언급량이 직전 52주 중앙값보다 최소 10건 많은 경우",
    topRisk:
      "향후 12주 최대 상승여력이 10% 이하이면서 최대 낙폭이 -10% 이하인 경우",
    matchedControl:
      "스파이크 주변 ±8주를 제외한 고점권 비스파이크 주 중 동일 추세·변동성 체제의 가장 가까운 주",
  },
  counts: {
    rawSpikes: rawSpikeIndexes.length,
    episodes: episodeIndexes.length,
    highZoneEpisodes: highZoneIndexes.length,
    highZoneCandidateWeeks: highZoneCandidateWeekIndexes.length,
    extremeHighZoneEpisodes: extremeHighZoneIndexes.length,
    extremeHighZoneCandidateWeeks: extremeHighZoneCandidateWeekIndexes.length,
    panicEpisodes: panicIndexes.length,
  },
  allSpikes: [4, 8, 12, 26].map((horizon) =>
    summarize(episodeIndexes, horizon, "전체 스파이크"),
  ),
  highZoneSpikes: [4, 8, 12, 26].map((horizon) =>
    summarize(highZoneIndexes, horizon, "고점권 스파이크"),
  ),
  extremeHighZoneSpikes: [4, 8, 12, 26].map((horizon) =>
    summarize(extremeHighZoneIndexes, horizon, "고점권 초대형 스파이크"),
  ),
  panicSpikes: [4, 8, 12, 26].map((horizon) =>
    summarize(panicIndexes, horizon, "패닉/저점권 스파이크"),
  ),
  matched: [4, 8, 12, 26].map(pairedSummary),
  sensitivity,
  extremeSensitivity,
  events: eventRows,
  validation: {
    referencePeakWeeks,
    selectedExtremePeakWeeks,
    missingReferencePeakWeeks,
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(outputPath);
