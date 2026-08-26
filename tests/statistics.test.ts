import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseSnapshot, type WeeklyPoint } from "../lib/dashboard-data";
import {
  enrichSeries,
  eventStudy,
  highZoneSpikeAnalysis,
  laggedReturns,
  leadLagMatrix,
  pearson,
  rollingCorrelations,
  spearman,
  walkForwardValidation,
  relativeChange,
} from "../lib/statistics";

const row = (
  week: string,
  posts: number,
  close: number | null,
): WeeklyPoint => ({
  week,
  postCount: posts,
  btcMean: close,
  btcClose: close,
  btcOpen: close,
  btcHigh: close === null ? null : close * 1.05,
  btcLow: close === null ? null : close * 0.95,
  btcVolume: close,
  btcExchangeClose: close,
  realizedVolatility: close === null ? null : 3,
  rangePct: close === null ? null : 10,
  priceObservations: close === null ? null : 7,
  nextWeekClose: null,
  nextWeekReturn: null,
  periodStatus: "complete",
});

describe("dashboard statistics", () => {
  it("keeps the prediction direction at posts(t) to return(t+h)", () => {
    const points = Array.from({ length: 29 }, (_, index) =>
      row(
        new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10),
        index % 3,
        100 * 1.1 ** index,
      ),
    );

    const returns = laggedReturns(enrichSeries(points), 1);
    expect(returns.map(({ week }) => week)).toEqual([
      points[26].week,
      points[27].week,
    ]);
    expect(returns[0].returnPct).toBeCloseTo(10);
    expect(returns[1].returnPct).toBeCloseTo(10);
  });

  it("does not invent a return across missing BTC observations", () => {
    const points = Array.from({ length: 28 }, (_, index) =>
      row(
        new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10),
        index % 3,
        index === 27 ? null : 100 + index,
      ),
    );
    expect(laggedReturns(enrichSeries(points), 1)).toEqual([]);
  });

  it("computes bounded correlation and percentage change", () => {
    expect(
      pearson([
        [1, 2],
        [2, 4],
        [3, 6],
      ]),
    ).toBeCloseTo(1);
    expect(relativeChange(110, 100)).toBeCloseTo(10);
    expect(relativeChange(110, null)).toBeNull();
  });

  it("uses average ranks for Spearman ties", () => {
    expect(
      spearman([
        [1, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ]),
    ).toBeCloseTo(0.948683, 5);
  });

  it("builds an empirical attention percentile from trailing history only", () => {
    const points = Array.from({ length: 54 }, (_, index) =>
      row(
        new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
        index === 53 ? 30 : index % 2,
        100 + index,
      ),
    );
    const enriched = enrichSeries(points);
    expect(enriched[25].attentionPercentile).toBeNull();
    expect(enriched[53].attentionPercentile).toBe(100);
    expect(enriched[53].isAttentionSpike).toBe(true);
    expect(enriched[53].mentionChange4w).toBeGreaterThan(0);
  });

  it("keeps tied zero counts measurable instead of dropping a zero MAD window", () => {
    const points = Array.from({ length: 27 }, (_, index) =>
      row(
        new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
        0,
        100 + index,
      ),
    );

    const latest = enrichSeries(points).at(-1)!;
    expect(latest.attentionPercentile).toBe(50);
    expect(latest.isAttentionSpike).toBe(false);
  });

  it("defines positive lag as attention leading the outcome", () => {
    const points = Array.from({ length: 80 }, (_, index) =>
      row(
        new Date(Date.UTC(2024, 0, 1 + index * 7)).toISOString().slice(0, 10),
        index % 2 ? 10 : 0,
        100 + index,
      ),
    );
    const attention = enrichSeries(points).map((point, index) => ({
      ...point,
      attentionPercentile: index < 30 ? null : index % 2 ? 75 : 25,
    }));
    const enriched = attention.map((point, index) => ({
      ...point,
      weeklyReturnPct:
        index > 30 ? attention[index - 1].attentionPercentile : null,
    }));
    const cell = leadLagMatrix(enriched, 2).find(
      (value) => value.outcome === "return" && value.lag === 1,
    );
    expect(cell?.pearson).toBeCloseTo(1);
  });

  it("event study excludes pre-event prices and overlapping spike windows", () => {
    const points = Array.from({ length: 60 }, (_, index) =>
      row(
        new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
        index % 2,
        100,
      ),
    );
    points[52].btcHigh = 1000;
    points[53].btcClose = 110;
    points[53].btcExchangeClose = 110;
    points[53].btcHigh = 112;
    const enriched = enrichSeries(points).map((point, index) => ({
      ...point,
      isAttentionSpike: index === 52 || index === 53,
    }));
    const result = eventStudy(enriched, [1])[0];
    expect(result.events).toBe(1);
    expect(result.medianReturnPct).toBeCloseTo(10);
    expect(result.medianMfePct).toBeCloseTo(12);
    expect(result.confidenceInterval).toBeNull();
  });

  it("rolling and walk-forward validation report only tested observations", () => {
    const points = Array.from({ length: 180 }, (_, index) =>
      row(
        new Date(Date.UTC(2023, 0, 2 + index * 7)).toISOString().slice(0, 10),
        index % 5,
        100 * 1.001 ** index,
      ),
    );
    const enriched = enrichSeries(points).map((point, index) => ({
      ...point,
      attentionPercentile: index < 26 ? null : (index % 7) * 15,
    }));
    expect(rollingCorrelations(enriched, 52)).not.toHaveLength(0);
    expect(walkForwardValidation(enriched, 52).observations).toBeGreaterThan(0);
  });

  it("requires both a meaningful count increase and a fivefold increase near a high", () => {
    const points = Array.from({ length: 42 }, (_, index) =>
      row(
        new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
        index < 40 ? 1 : index === 40 ? 5 : 12,
        100 + index,
      ),
    );

    const analysis = highZoneSpikeAnalysis(enrichSeries(points));
    expect(analysis.episodes).toHaveLength(1);
    expect(analysis.episodes[0].firstTrigger.week).toBe(points[41].week);
    expect(analysis.episodes[0].firstTrigger.postCount).toBe(12);
  });

  it("separates the real-time first alert from the later ex-post mention peak", () => {
    const points = Array.from({ length: 43 }, (_, index) =>
      row(
        new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
        index === 40 ? 12 : index === 41 ? 20 : 1,
        100 + index,
      ),
    );

    const episode = highZoneSpikeAnalysis(enrichSeries(points)).episodes[0];
    expect(episode.firstTrigger.week).toBe(points[40].week);
    expect(episode.representativePeak.week).toBe(points[41].week);
    expect(episode.representativePeak.postCount).toBeGreaterThan(
      episode.firstTrigger.postCount,
    );
  });

  it("preserves the seven corrected historical peak episodes in the published data", () => {
    const snapshot = parseSnapshot(
      JSON.parse(readFileSync("public/data.json", "utf8")) as unknown,
    );
    const analysis = highZoneSpikeAnalysis(enrichSeries(snapshot.series));

    expect(
      analysis.episodes.map((episode) => episode.representativePeak.week),
    ).toEqual([
      "2017-12-04",
      "2021-01-04",
      "2021-02-15",
      "2021-04-12",
      "2024-03-11",
      "2024-11-18",
      "2025-10-06",
    ]);
    expect(analysis.representativePeakSummary.negativeReturn4wPct).toBeCloseTo(
      71.4,
      1,
    );
    expect(analysis.firstTriggerSummary.medianUpside12wPct).toBeGreaterThan(10);
    expect(analysis.horizonComparison.map((item) => item.horizon)).toEqual([
      1, 2, 4, 8, 12,
    ]);
    expect(
      analysis.benchmark12w.find((item) => item.key === "first_trigger")
        ?.observations,
    ).toBe(7);
    expect(analysis.sensitivity.find((item) => item.selected)?.events).toBe(7);
  });
});
