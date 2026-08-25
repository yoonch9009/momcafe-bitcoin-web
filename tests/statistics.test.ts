import { describe, expect, it } from "vitest";

import type { WeeklyPoint } from "../lib/dashboard-data";
import { laggedReturns, pearson, relativeChange } from "../lib/statistics";

const row = (
  week: string,
  posts: number,
  close: number | null,
): WeeklyPoint => ({
  week,
  postCount: posts,
  btcMean: close,
  btcClose: close,
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
});
