import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartSeries {
  key: string;
  color: string;
  label: string;
}

interface LiveChartProps {
  data: readonly Record<string, number | undefined>[];
  xKey: string;
  xLabel?: string;
  yLabel?: string;
  series: ChartSeries[];
  height?: number;
  yDomain?: [number | "auto", number | "auto"];
  /** "number" makes the X axis respect actual numeric spacing/order (e.g. closed P–V loops); default "category" preserves array order. */
  xType?: "number" | "category";
}

// recharts calls tickFormatter with whatever raw value sits at that tick,
// which on a "category" axis (LiveChart's default xType) isn't guaranteed
// to be numeric — crashed the page on some topics when it passed through a
// non-number and .toFixed() threw.
const fmt = (v: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)) : String(v);
};

// guards against recharts producing duplicate tick keys when the data range is
// nearly constant (e.g. a conserved quantity) by padding out a degenerate domain
const paddedDomain = [
  (min: number) => min - Math.max(Math.abs(min) * 0.08, 0.05),
  (max: number) => max + Math.max(Math.abs(max) * 0.08, 0.05),
] as const;

export function LiveChart({ data, xKey, xLabel, yLabel, series, height = 190, yDomain, xType = "category" }: LiveChartProps) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: yLabel ? 4 : -6 }}>
          <CartesianGrid stroke="#232328" strokeDasharray="3 3" />
          <XAxis
            dataKey={xKey}
            type={xType}
            domain={xType === "number" ? ["auto", "auto"] : undefined}
            stroke="#71717a"
            fontSize={11}
            tickFormatter={fmt}
            label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, fill: "#71717a", fontSize: 11 } : undefined}
          />
          <YAxis
            stroke="#71717a"
            fontSize={11}
            width={38}
            tickFormatter={fmt}
            domain={yDomain ?? paddedDomain}
            allowDecimals
            label={
              yLabel
                ? { value: yLabel, angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 }
                : undefined
            }
          />
          <Tooltip
            contentStyle={{ background: "#17171b", border: "1px solid #232328", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(value) => fmt(Number(value))}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
