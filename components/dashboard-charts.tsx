"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  EventStudyResult,
  RollingCorrelation,
  ScatterPoint,
} from "@/lib/statistics";

export type Metric =
  | "close"
  | "mean"
  | "volume"
  | "volatility"
  | "range"
  | "attention"
  | "nextReturn";

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

const metricNames: Record<Metric, string> = {
  close: "BTC 주간 종가",
  mean: "BTC 주간 평균가",
  volume: "BTC 주간 거래량",
  volatility: "주간 실현변동성",
  range: "주간 고저 변동폭",
  attention: "관심도 백분위",
  nextReturn: "다음 주 수익률",
};

export function TimelineChart({
  data,
  metric,
  logarithmic,
  alertWeeks = [],
}: {
  data: TimelinePoint[];
  metric: Metric;
  logarithmic: boolean;
  alertWeeks?: string[];
}) {
  const isPercent = ["volatility", "range", "nextReturn"].includes(metric);
  const formatMetricValue = (value: number) =>
    metric === "attention"
      ? `${decimal.format(value)}백분위`
      : isPercent
        ? `${decimal.format(value)}%`
        : compact.format(value);
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
          domain={
            metric === "attention"
              ? [0, 100]
              : logarithmic
                ? ["auto", "auto"]
                : undefined
          }
          orientation="right"
          scale={logarithmic ? "log" : "auto"}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={formatMetricValue}
          tickLine={false}
          type="number"
          width={55}
          yAxisId="metric"
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
          formatter={(value, name) => [
            name === metricNames[metric]
              ? formatMetricValue(Number(value))
              : compact.format(Number(value)),
            name,
          ]}
          labelFormatter={(label) => `${String(label)} 주`}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ color: "var(--muted)", fontSize: 11, paddingTop: 12 }}
        />
        {alertWeeks.map((week) => (
          <ReferenceLine
            key={week}
            stroke="var(--orange)"
            strokeDasharray="3 4"
            strokeOpacity={0.75}
            x={week}
          />
        ))}
        <Bar
          dataKey="posts"
          fill="var(--cyan)"
          fillOpacity={0.42}
          name="맘카페 주간 언급량"
          radius={[3, 3, 0, 0]}
          yAxisId="posts"
        />
        <Line
          connectNulls={false}
          dataKey="value"
          dot={false}
          name={metricNames[metric]}
          stroke="var(--orange)"
          strokeWidth={2.25}
          type="monotone"
          yAxisId="metric"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export type AlertPathPoint = {
  horizon: number;
  firstTriggerMedianReturnPct: number | null;
  representativePeakMedianReturnPct: number | null;
};

export function AlertPathChart({ data }: { data: AlertPathPoint[] }) {
  const chartData = data.map((item) => ({
    ...item,
    label: `+${item.horizon}주`,
  }));
  return (
    <ResponsiveContainer height="100%" width="100%">
      <BarChart
        data={chartData}
        margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
      >
        <CartesianGrid
          stroke="var(--grid)"
          strokeDasharray="3 5"
          vertical={false}
        />
        <XAxis
          axisLine={false}
          dataKey="label"
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={(value: number) => `${decimal.format(value)}%`}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-strong)",
            border: "1px solid var(--line-strong)",
            borderRadius: 12,
            color: "var(--ink)",
            fontSize: 12,
          }}
          formatter={(value, name) => [
            `${decimal.format(Number(value))}%`,
            name,
          ]}
        />
        <Legend wrapperStyle={{ color: "var(--muted)", fontSize: 11 }} />
        <ReferenceLine stroke="var(--line-strong)" y={0} />
        <Bar
          dataKey="firstTriggerMedianReturnPct"
          fill="var(--cyan)"
          fillOpacity={0.72}
          name="실시간 첫 경보"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="representativePeakMedianReturnPct"
          fill="var(--orange)"
          fillOpacity={0.8}
          name="언급량 정점(사후)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
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
          dataKey="attentionPercentile"
          domain={[0, 100]}
          name="관심도 백분위"
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickLine={false}
          type="number"
          unit="백분위"
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
        <ReferenceLine stroke="var(--line-strong)" y={0} />
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

export function RollingCorrelationChart({
  data,
}: {
  data: RollingCorrelation[];
}) {
  return (
    <ResponsiveContainer height="100%" width="100%">
      <LineChart
        data={data}
        margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
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
          domain={[-1, 1]}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-strong)",
            border: "1px solid var(--line-strong)",
            borderRadius: 12,
            color: "var(--ink)",
            fontSize: 12,
          }}
          formatter={(value, name) => [decimal.format(Number(value)), name]}
        />
        <Legend wrapperStyle={{ color: "var(--muted)", fontSize: 11 }} />
        <ReferenceLine stroke="var(--line-strong)" y={0} />
        <Line
          connectNulls={false}
          dataKey="pearson"
          dot={false}
          name="Pearson"
          stroke="var(--orange)"
          strokeWidth={2}
        />
        <Line
          connectNulls={false}
          dataKey="spearman"
          dot={false}
          name="Spearman"
          stroke="var(--cyan)"
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function EventStudyChart({ data }: { data: EventStudyResult[] }) {
  const chartData = data.map((item) => ({
    ...item,
    label: `+${item.horizon}주`,
  }));
  return (
    <ResponsiveContainer height="100%" width="100%">
      <BarChart
        data={chartData}
        margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
      >
        <CartesianGrid
          stroke="var(--grid)"
          strokeDasharray="3 5"
          vertical={false}
        />
        <XAxis
          axisLine={false}
          dataKey="label"
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickFormatter={(value: number) => `${decimal.format(value)}%`}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-strong)",
            border: "1px solid var(--line-strong)",
            borderRadius: 12,
            color: "var(--ink)",
            fontSize: 12,
          }}
          formatter={(value) => [
            `${decimal.format(Number(value))}%`,
            "수익률 중앙값",
          ]}
        />
        <ReferenceLine stroke="var(--line-strong)" y={0} />
        <Bar
          dataKey="medianReturnPct"
          fill="var(--orange)"
          fillOpacity={0.76}
          name="수익률 중앙값"
          radius={[5, 5, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
