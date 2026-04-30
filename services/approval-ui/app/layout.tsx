import type { Metadata } from "next";
import { interVariable, jetbrainsMonoVariable } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipstack — Mission Control",
  description: "The institutional memory layer for marketing teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Dark mode is the default per Doc 8 hard rule #6. Light mode is parallel.
  return (
    <html
      lang="en"
      className={`${interVariable.variable} ${jetbrainsMonoVariable.variable} dark`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
