// Doc 8 §4 — paste-ready. Do not "improve" or extend without updating Doc 8 first.
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base:     "var(--bg-base)",
          subtle:   "var(--bg-subtle)",
          surface:  "var(--bg-surface)",
          elevated: "var(--bg-elevated)",
        },
        border: {
          subtle:  "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
          strong:  "var(--border-strong)",
        },
        text: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary:  "var(--text-tertiary)",
          inverted:  "var(--text-inverted)",
        },
        accent: {
          50:      "var(--accent-50)",
          100:     "var(--accent-100)",
          200:     "var(--accent-200)",
          300:     "var(--accent-300)",
          400:     "var(--accent-400)",
          500:     "var(--accent-500)",
          600:     "var(--accent-600)",
          700:     "var(--accent-700)",
          800:     "var(--accent-800)",
          900:     "var(--accent-900)",
          DEFAULT: "var(--accent-500)",
        },
        status: {
          success: "var(--status-success)",
          warning: "var(--status-warning)",
          danger:  "var(--status-danger)",
          info:    "var(--status-info)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      fontSize: {
        xs:    ["0.75rem",   { lineHeight: "1rem" }],
        sm:    ["0.8125rem", { lineHeight: "1.25rem" }],
        base:  ["0.875rem",  { lineHeight: "1.375rem", letterSpacing: "-0.005em" }],
        md:    ["1rem",      { lineHeight: "1.5rem",   letterSpacing: "-0.01em" }],
        lg:    ["1.125rem",  { lineHeight: "1.625rem", letterSpacing: "-0.015em" }],
        xl:    ["1.25rem",   { lineHeight: "1.75rem",  letterSpacing: "-0.02em" }],
        "2xl": ["1.5rem",    { lineHeight: "2rem",     letterSpacing: "-0.025em" }],
        "3xl": ["1.875rem",  { lineHeight: "2.25rem",  letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        xs: "2px",
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(0, 0, 0, 0.04)",
        sm: "0 2px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
        md: "0 4px 8px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)",
        lg: "0 12px 24px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.06)",
        xl: "0 24px 48px rgba(0, 0, 0, 0.16)",
      },
      transitionDuration: {
        instant: "80ms",
        fast: "150ms",
        normal: "200ms",
        slow: "300ms",
      },
      transitionTimingFunction: {
        default: "cubic-bezier(0.4, 0, 0.2, 1)",
        out: "cubic-bezier(0, 0, 0.2, 1)",
        in: "cubic-bezier(0.4, 0, 1, 1)",
      },
      keyframes: {
        // Doc 8 §10.3 — tile pulse for "working" agent state
        "tile-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(63, 169, 160, 0.0)" },
          "50%":      { boxShadow: "0 0 0 4px rgba(63, 169, 160, 0.15)" },
        },
        // Doc 8 §10.4 — status dot pulse
        "status-dot-pulse": {
          "0%, 100%": { opacity: "0.8" },
          "50%":      { opacity: "1.0" },
        },
      },
      animation: {
        "tile-pulse":       "tile-pulse 2.4s ease-in-out infinite",
        "status-dot-pulse": "status-dot-pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
