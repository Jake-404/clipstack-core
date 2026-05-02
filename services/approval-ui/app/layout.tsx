import type { Metadata } from "next";
import { interVariable, jetbrainsMonoVariable } from "./fonts";
import "./globals.css";
import { KeyboardShortcuts } from "@/components/keyboard/KeyboardShortcuts";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Clipstack — Mission Control",
  description: "The institutional memory layer for marketing teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Dark mode is the default per Doc 8 hard rule #6. Light mode is parallel.
  //
  // The two providers wrap every page so any client component can call
  // useToast() and the global keyboard listener is alive on every route.
  // KeyboardShortcuts itself renders no visible DOM — it owns the help +
  // command palette modals and a single document-level keydown listener.
  return (
    <html
      lang="en"
      className={`${interVariable.variable} ${jetbrainsMonoVariable.variable} dark`}
      suppressHydrationWarning
    >
      <body>
        <ToastProvider>
          <KeyboardShortcuts />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
