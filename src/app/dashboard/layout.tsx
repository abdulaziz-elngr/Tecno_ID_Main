import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { OverdueNotices } from "@/components/payments/OverdueNotices";
import { TableCards } from "@/components/TableCards";
import { PermissionsProvider } from "@/components/PermissionsProvider";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionsProvider>
    <div className="flex min-h-screen bg-surface-light-muted dark:bg-surface-dark">
      <TableCards />
      <Sidebar />
      {/* min-w-0 is essential: without it a wide table/grid inside a flex child
          stretches the whole page instead of scrolling inside its own card. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-3 sm:p-4 md:p-6 print:max-w-none">
          <div className="no-print mb-4 empty:hidden"><OverdueNotices compact /></div>
          {children}
        </main>
      </div>
    </div>
    </PermissionsProvider>
  );
}
