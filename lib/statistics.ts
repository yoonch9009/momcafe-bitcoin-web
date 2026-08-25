import type { WeeklyPoint } from "@/lib/dashboard-data";

export function pearson(
  values: Array<readonly [number, number]>,
): number | null {
  if (values.length < 3) return null;
  let xMean = 0;
  let yMean = 0;
  for (const [x, y] of values) {
    xMean += x;
    yMean += y;
  }
  xMean /= values.length;
  yMean /= values.length;

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

export type ScatterPoint = {
  week: string;
  posts: number;
  returnPct: number;
};

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
    ) {
      continue;
    }
    result.push({
      week: start.week,
      posts: start.postCount,
      returnPct: (end.btcClose / start.btcClose - 1) * 100,
    });
  }
  return result;
}

export function relativeChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}
