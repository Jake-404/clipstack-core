// Doc 8 §9.2 — secondary metric tile. Single number + sparkline + tone hint.
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Sparkline } from "./Sparkline";
import { cn } from "@/lib/utils";

interface MetricTileProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: number; label?: string };
  trend?: number[];
  size?: "small" | "medium" | "wide";
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  className?: string;
}

export function MetricTile({
  label,
  value,
  unit,
  delta,
  trend,
  size = "medium",
  tone = "default",
  className,
}: MetricTileProps) {
  const deltaTone =
    delta === undefined
      ? "text-text-tertiary"
      : delta.value > 0
        ? "text-status-success"
        : delta.value < 0
          ? "text-status-danger"
          : "text-text-tertiary";

  return (
    <Card size={size} tone={tone} className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardLabel>{label}</CardLabel>
      </CardHeader>
      <div className="flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
          {value}
        </span>
        {unit && <span className="text-xs text-text-tertiary">{unit}</span>}
      </div>
      {delta && (
        <div className={cn("mt-1 text-xs font-mono tabular-nums", deltaTone)}>
          {delta.value >= 0 ? "+" : ""}
          {delta.value}
          {delta.label && <span className="text-text-tertiary ml-1.5">{delta.label}</span>}
        </div>
      )}
      {trend && trend.length > 1 && (
        <div className="mt-auto pt-3">
          <Sparkline values={trend} width={120} height={24} />
        </div>
      )}
    </Card>
  );
}
