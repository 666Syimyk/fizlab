import { Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface HistogramOverlay {
  key: string;
  color: string;
  label: string;
}

interface HistogramProps {
  data: readonly Record<string, number | string>[];
  xKey: string;
  barKey: string;
  barColor?: string;
  xLabel?: string;
  yLabel?: string;
  overlay?: HistogramOverlay;
  height?: number;
}

// See LiveChart.tsx: recharts' tickFormatter isn't guaranteed to receive a
// number, so this guards against a crash on non-numeric tick values.
const fmt = (v: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)) : String(v);
};

/** Bar chart (e.g. live speed histogram) with an optional theoretical-curve overlay line. */
export function Histogram({ data, xKey, barKey, barColor = "#7c6cf5", xLabel, yLabel, overlay, height = 190 }: HistogramProps) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: xLabel ? 4 : -6 }}>
          <CartesianGrid stroke="#232328" strokeDasharray="3 3" />
          <XAxis
            dataKey={xKey}
            stroke="#71717a"
            fontSize={11}
            tickFormatter={fmt}
            label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, fill: "#71717a", fontSize: 11 } : undefined}
          />
          <YAxis
            stroke="#71717a"
            fontSize={11}
            width={34}
            label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 } : undefined}
          />
          <Tooltip
            contentStyle={{ background: "#17171b", border: "1px solid #232328", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#a1a1aa" }}
          />
          <Bar dataKey={barKey} fill={barColor} isAnimationActive={false} radius={[2, 2, 0, 0]} />
          {overlay && (
            <Line
              type="monotone"
              dataKey={overlay.key}
              name={overlay.label}
              stroke={overlay.color}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
