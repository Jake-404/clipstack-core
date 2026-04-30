// Doc 8 §11.5 — sparkline. 80×24px, stroke 1.5px, accent-500.
// Pure SVG, no charting library — keeps Mission Control bundle small.
"use client";
import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
}

export function Sparkline({
  values,
  width = 80,
  height = 24,
  stroke = "var(--accent-500)",
  strokeWidth = 1.5,
  className,
}: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={cn("block", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
