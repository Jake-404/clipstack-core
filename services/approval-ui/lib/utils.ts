import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn() — class name merger. Standard shadcn/ui helper.
 * Resolves Tailwind class conflicts so component variants compose cleanly.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * formatMono() — format a number for mono-font display (Doc 8 §11.1).
 * Use for percentiles, counts, prices, IDs, timestamps.
 */
export function formatMono(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat("en-US", { useGrouping: true, ...opts }).format(value);
}
