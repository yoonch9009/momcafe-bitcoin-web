export type PeriodStatus = "complete" | "in_progress";

export type WeeklyPoint = {
  week: string;
  postCount: number;
  btcMean: number | null;
  btcClose: number | null;
  nextWeekClose: number | null;
  nextWeekReturn: number | null;
  periodStatus: PeriodStatus;
};

export type DashboardSnapshot = {
  schemaVersion: 3;
  timezone: "Asia/Seoul";
  weekStart: "MON";
  updatedAt: string;
  series: WeeklyPoint[];
  kpis: {
    latestWeek: {
      week: string;
      periodStatus: PeriodStatus;
      posts: number;
      btcClose: number;
      nextWeekReturn: number | null;
    };
  };
  collection: {
    mode: "incremental";
    price: {
      status: "ok";
      source: string;
      observedThrough: string;
      requestedDays: number;
    };
    posts: {
      status: "ok" | "degraded";
      sourceCount: number;
      refreshFrom: string;
      failures: string[];
    };
  };
  meta: { keyword: string; note: string };
};

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

export function parseSnapshot(value: unknown): DashboardSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("데이터가 JSON 객체가 아닙니다.");
  }
  const snapshot = value as Partial<DashboardSnapshot>;
  if (snapshot.schemaVersion !== 3 || !Array.isArray(snapshot.series)) {
    throw new Error("지원하지 않는 데이터 스키마입니다.");
  }
  if (!snapshot.updatedAt || !snapshot.collection || !snapshot.kpis) {
    throw new Error("데이터 메타 정보가 누락되었습니다.");
  }
  let previousWeek = "";
  for (const point of snapshot.series) {
    if (
      !point ||
      typeof point.week !== "string" ||
      point.week <= previousWeek ||
      typeof point.postCount !== "number" ||
      !isNullableNumber(point.btcMean) ||
      !isNullableNumber(point.btcClose) ||
      !isNullableNumber(point.nextWeekClose) ||
      !isNullableNumber(point.nextWeekReturn)
    ) {
      throw new Error("주간 시계열이 손상되었거나 정렬되지 않았습니다.");
    }
    previousWeek = point.week;
  }
  return snapshot as DashboardSnapshot;
}

export function assetPath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
