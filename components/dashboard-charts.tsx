"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ScatterPoint } from "@/lib/statistics";

export type Metric = "close" | "mean" | "nextReturn";

export type TimelinePoint = {
  week: string;
  posts: number;
  value: number | null;
};

const compact = new Intl.NumberFormat("ko-KR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

function shortWeek(value: string) {
  return value.slice(2).replaceAll("-", ".");
}

export function TimelineChart({
  data,
  metric,
  logarithmic,
}: {
  data: TimelinePoint[];
  metric: Metric;
  logarithmic: boolean;
}) {
  const isReturn = metric === "nextReturn";
  const priceName =
    metric === "close"
      ? "BTC 주간 종가"
      : metric === "mean"
        ? "BTC 주간 평균"
        : "다음 주 수익률";
  return (
    <ResponsiveContainer height="100%" width="100%">
      <ComposedChart
        data={data}
        margin={{ top: 14, right: 8, bottom: 4, left: 0 }}
      >
        <CartesianGrid
          stroke="var(--grid)"
          strokeDasharray="3 5"
          vertical={false}
        />
        <XAxis
          axisLine={false}
          dataKey="week"
          minTickGap={44}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={shortWeek}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={(value: number) => compact.format(value)}
          tickLine={false}
          width={46}
          yAxisId="posts"
        />
        <YAxis
          axisLine={false}
          domain={logarithmic && !isReturn ? ["auto", "auto"] : undefined}
          orientation="right"
          scale={logarithmic && !isReturn ? "log" : "auto"}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={(value: number) =>
            isReturn ? `${decimal.format(value)}%` : compact.format(value)
          }
          tickLine={false}
          type="number"
          width={52}
          yAxisId="price"
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-strong)",
            border: "1px solid var(--line-strong)",
            borderRadius: 12,
            color: "var(--ink)",
            fontSize: 12,
          }}
          cursor={{ fill: "var(--grid)" }}
          labelFormatter={(label) => `${String(label)} 주`}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ color: "var(--muted)", fontSize: 11, paddingTop: 12 }}
        />
        <Bar
          dataKey="posts"
          fill="var(--cyan)"
          fillOpacity={0.5}
          name="맘카페 언급"
          radius={[3, 3, 0, 0]}
          yAxisId="posts"
        />
        <Line
          connectNulls={false}
          dataKey="value"
          dot={false}
          name={priceName}
          stroke="var(--orange)"
          strokeWidth={2.25}
          type="monotone"
          yAxisId="price"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CorrelationChart({ data }: { data: ScatterPoint[] }) {
  return (
    <ResponsiveContainer height="100%" width="100%">
      <ScatterChart margin={{ top: 12, right: 12, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" strokeDasharray="3 5" />
        <XAxis
          axisLine={false}
          dataKey="posts"
          name="게시글"
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickLine={false}
          type="number"
          unit="건"
        />
        <YAxis
          axisLine={false}
          dataKey="returnPct"
          name="수익률"
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={(value: number) => `${decimal.format(value)}%`}
          tickLine={false}
          type="number"
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-strong)",
            border: "1px solid var(--line-strong)",
            borderRadius: 12,
            color: "var(--ink)",
            fontSize: 12,
          }}
          cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 4" }}
        />
        <Scatter
          data={data}
          fill="var(--cyan)"
          fillOpacity={0.72}
          name="관측 주"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
