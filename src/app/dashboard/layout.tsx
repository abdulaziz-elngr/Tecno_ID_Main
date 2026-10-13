import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { OverdueNotices } from "@/components/payments/OverdueNotices";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface-light-muted dark:bg-surface-dark">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-4 md:p-6">
          <div className="mb-4 empty:hidden"><OverdueNotices compact /></div>
          {children}
        </main>
      </div>
    </div>
  );
}
