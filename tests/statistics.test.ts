import { describe, expect, it } from "vitest";

import type { WeeklyPoint } from "../lib/dashboard-data";
import {
  enrichSeries,
  eventStudy,
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
    const points = [
      row("2026-08-03", 1, 100),
      row("2026-08-10", 2, 110),
      row("2026-08-17", 3, 121),
    ];

    const returns = laggedReturns(points, 1);
    expect(returns.map(({ week, posts }) => ({ week, posts }))).toEqual([
      { week: "2026-08-03", posts: 1 },
      { week: "2026-08-10", posts: 2 },
    ]);
    expect(returns[0].returnPct).toBeCloseTo(10);
    expect(returns[1].returnPct).toBeCloseTo(10);
  });

  it("does not invent a return across missing BTC observations", () => {
    const points = [
      row("2026-08-03", 1, 100),
      row("2026-08-10", 2, null),
      row("2026-08-17", 3, 121),
    ];
    expect(laggedReturns(points, 1)).toEqual([]);
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

  it("builds attention surprise from trailing history only", () => {
    const points = Array.from({ length: 54 }, (_, index) =>
      row(
        new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
        index === 53 ? 30 : index % 2,
        100 + index,
      ),
    );
    const enriched = enrichSeries(points);
    expect(enriched[25].attentionScore).toBeNull();
    expect(enriched[53].attentionScore).toBeGreaterThan(2);
    expect(enriched[53].mentionMomentum4w).toBeGreaterThan(0);
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
      attentionScore: index < 30 ? null : index % 2 ? 1 : -1,
    }));
    const enriched = attention.map((point, index) => ({
      ...point,
      weeklyReturnPct: index > 30 ? attention[index - 1].attentionScore : null,
    }));
    const cell = leadLagMatrix(enriched, 2).find(
      (value) => value.outcome === "return" && value.lag === 1,
    );
    expect(cell?.pearson).toBeCloseTo(1);
  });

  it("event study never uses prices before the event as future excursion", () => {
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
      attentionScore: index === 52 ? 3 : point.attentionScore,
    }));
    const result = eventStudy(enriched, 2, [1])[0];
    expect(result.events).toBe(1);
    expect(result.medianReturnPct).toBeCloseTo(10);
    expect(result.medianMfePct).toBeCloseTo(12);
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
      attentionScore: index < 26 ? null : (index % 7) - 3,
    }));
    expect(rollingCorrelations(enriched, 52)).not.toHaveLength(0);
    expect(walkForwardValidation(enriched, 52).observations).toBeGreaterThan(0);
  });
});
