// Doc 8 §11.7 — agents are geometric marks, not faces. Fixed 8-colour palette.
// No anthropomorphic styling, ever (Doc 7 anti-pattern + Doc 8 hard rule).
import { cn } from "@/lib/utils";

export type AgentMarkShape =
  | "circle"
  | "square"
  | "hexagon"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "octagon"
  | "rounded-square";

export type AgentMarkColor =
  | "teal"      // mira / orchestrator
  | "amber"     // strategist
  | "violet"    // copywriter / long-form writer
  | "rose"      // social adapter
  | "sky"       // brand qa
  | "emerald"   // researcher
  | "slate"     // editor
  | "fuchsia";  // analyst

export type AgentStatus = "idle" | "working" | "blocked" | "error" | "asleep";

const colorClass: Record<AgentMarkColor, string> = {
  teal:     "bg-[var(--accent-500)] text-[var(--text-inverted)]",
  amber:    "bg-[#F2A93A] text-[#0B0C0E]",
  violet:   "bg-[#9B7AE5] text-[#0B0C0E]",
  rose:     "bg-[#E58FA0] text-[#0B0C0E]",
  sky:      "bg-[#5B8DE5] text-[#0B0C0E]",
  emerald:  "bg-[#3DC580] text-[#0B0C0E]",
  slate:    "bg-[#94979E] text-[#0B0C0E]",
  fuchsia:  "bg-[#D55BD5] text-[#0B0C0E]",
};

const shapeMask: Record<AgentMarkShape, string> = {
  circle:           "rounded-full",
  square:           "rounded-none",
  "rounded-square": "rounded-md",
  hexagon:          "[clip-path:polygon(25%_0%,75%_0%,100%_50%,75%_100%,25%_100%,0%_50%)]",
  triangle:         "[clip-path:polygon(50%_0%,100%_100%,0%_100%)]",
  diamond:          "[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]",
  pentagon:         "[clip-path:polygon(50%_0%,100%_38%,82%_100%,18%_100%,0%_38%)]",
  octagon:          "[clip-path:polygon(30%_0%,70%_0%,100%_30%,100%_70%,70%_100%,30%_100%,0%_70%,0%_30%)]",
};

const statusOpacity: Record<AgentStatus, string> = {
  idle:    "opacity-100",
  working: "opacity-100 animate-status-dot-pulse",
  blocked: "opacity-60",
  error:   "opacity-100 ring-2 ring-status-danger ring-offset-2 ring-offset-bg-base",
  asleep:  "opacity-30",
};

const sizeClass = {
  xs: "h-4 w-4",
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
  xl: "h-12 w-12",
} as const;

export interface AgentMarkProps {
  shape: AgentMarkShape;
  color: AgentMarkColor;
  status?: AgentStatus;
  size?: keyof typeof sizeClass;
  initial?: string; // optional 1-letter code; never a face
  className?: string;
  title?: string;
}

export function AgentMark({
  shape,
  color,
  status = "idle",
  size = "md",
  initial,
  className,
  title,
}: AgentMarkProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex items-center justify-center font-mono text-xs font-medium select-none",
        sizeClass[size],
        shapeMask[shape],
        colorClass[color],
        statusOpacity[status],
        className,
      )}
    >
      {initial && shape !== "triangle" ? initial.slice(0, 1).toUpperCase() : null}
    </span>
  );
}
