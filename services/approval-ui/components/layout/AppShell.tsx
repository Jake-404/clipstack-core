// Doc 8 §9.1 — App Shell. Sidebar + main + (eventual) chat dock.
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-text-primary">
      <Sidebar />
      <main className="flex flex-1 flex-col min-w-0">
        <TopBar title={title} />
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
