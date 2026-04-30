// Doc 8 §8.6 — Sidebar. w-60, bg-subtle, border-r border-subtle.
// Section labels uppercase tracked per Doc 8 §11.2.
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  PenLine,
  Calendar,
  Users,
  TrendingUp,
  Settings,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Doc 7 §2.4 — persistent global elements; Mission Control is the home.
const sections: NavSection[] = [
  {
    label: "Daily",
    items: [
      { label: "Mission Control", href: "/",            icon: LayoutDashboard, shortcut: "G H" },
      { label: "Inbox",           href: "/inbox",       icon: Inbox,           shortcut: "G I" },
      { label: "Workspace",       href: "/workspace",   icon: PenLine,         shortcut: "G W" },
      { label: "Calendar",        href: "/calendar",    icon: Calendar,        shortcut: "G C" },
    ],
  },
  {
    label: "Insight",
    items: [
      { label: "Performance",     href: "/performance", icon: TrendingUp },
      { label: "Activity",        href: "/activity",    icon: Activity },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Members",         href: "/members",     icon: Users },
      { label: "Settings",        href: "/settings",    icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-border-subtle bg-bg-subtle">
      <div className="flex h-14 items-center px-4 border-b border-border-subtle">
        <span className="font-semibold text-text-primary tracking-tight">Clipstack</span>
        <span className="ml-auto font-mono text-xs text-text-tertiary">core/0.1.0</span>
      </div>
      <nav className="px-2 py-3 space-y-5">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-2 mb-1 text-xs uppercase tracking-wider font-medium text-text-tertiary">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors duration-fast ease-default",
                        active
                          ? "bg-bg-elevated text-text-primary"
                          : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.shortcut && (
                        <span className="font-mono text-xs text-text-tertiary opacity-0 group-hover:opacity-100">
                          {item.shortcut}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
