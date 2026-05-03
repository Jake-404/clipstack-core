// Doc 8 §9.1 — App Shell. Sidebar + main + (eventual) chat dock.
//
// AppShell now owns the mobile-drawer state: a single boolean toggled by
// the TopBar's hamburger and consumed by the Sidebar drawer overlay. On
// md+ viewports the sidebar is permanently in the flex column and the
// state is inert; on <md the column collapses and the drawer takes over.
"use client";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-text-primary">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <main className="flex flex-1 flex-col min-w-0">
        <TopBar
          title={title}
          onMobileMenuOpen={() => setMobileNavOpen(true)}
        />
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
