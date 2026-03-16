"use client";

import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartData } from "@/types/chat";

interface Props {
  chart: ChartData;
}

const COLORS = [
  "rgba(41,151,255,0.8)",
  "rgba(120,220,120,0.8)",
  "rgba(255,160,60,0.8)",
  "rgba(200,80,200,0.8)",
  "rgba(80,220,220,0.8)",
];

const STROKE_COLORS = ["#78b4ff", "#78dc78", "#ffa03c", "#c850c8", "#50dcdc"];

export default function ChartWidget({ chart }: Props) {
  const data = chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    chart.datasets.forEach((ds) => {
      row[ds.label] = ds.data[i] ?? 0;
    });
    return row;
  });

  const tooltipStyle = {
    background: "rgba(10,10,20,0.95)",
    border: "0.5px solid rgba(255,255,255,0.15)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
  };
  const axisStyle = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };
  const legendStyle = { fontSize: 11, color: "rgba(255,255,255,0.5)" };

  return (
    <div className="mt-3 rounded-xl bg-black/40 border border-white/9 p-4">
      {chart.title && (
        <p className="text-[rgba(120,180,255,0.92)] text-[13px] font-semibold mb-3">
          {chart.title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={240}>
        {chart.type === "line" ? (
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />
            <XAxis dataKey="name" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={legendStyle} />
            {chart.datasets.map((ds, i) => (
              <Line
                key={ds.label}
                type="monotone"
                dataKey={ds.label}
                stroke={STROKE_COLORS[i % STROKE_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />
            <XAxis dataKey="name" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={legendStyle} />
            {chart.datasets.map((ds, i) => (
              <Bar
                key={ds.label}
                dataKey={ds.label}
                fill={COLORS[i % COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
