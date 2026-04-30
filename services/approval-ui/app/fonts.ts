// Doc 8 §6 — variable fonts only, self-hosted via next/font.
// next/font/google self-hosts at build time (downloads + serves from same origin),
// so no CDN runtime dependency. To swap to fully local WOFF2 files (rsms.me/inter,
// jetbrains.com/lp/mono), change the import to next/font/local — see Doc 8 §6.

import { Inter, JetBrains_Mono } from "next/font/google";

export const interVariable = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  // Inter Variable supports the full weight range; we constrain to 400/500/600
  // because Doc 8 hard rule: no weight 700+ in product.
  weight: ["400", "500", "600"],
});

export const jetbrainsMonoVariable = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"],
});
