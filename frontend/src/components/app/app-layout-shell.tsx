"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app/app-sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { MobileNav } from "@/components/app/mobile-nav";
import type { Role } from "@/lib/types";

export function AppLayoutShell({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const isExamAttempt =
    pathname.includes("/mock/attempt") ||
    pathname.includes("/tests/attempt") ||
    pathname.includes("/demo/mock") ||
    pathname.includes("/simulator");

  // Prevent accidental navigation away during exam attempt
  React.useEffect(() => {
    if (!isExamAttempt) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isExamAttempt]);

  if (isExamAttempt) {
    return (
      <div className="fixed inset-0 z-50 h-screen w-screen overflow-hidden bg-bg">
        {/* Same side padding as normal pages: the runner's edge-to-edge header (-mx-4)
            relies on it, otherwise it overshoots both screen edges on phones. */}
        <main className="h-full w-full overflow-y-auto px-4 sm:px-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-bg">
      <AppSidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar role={role} />
        <main className="flex-1 px-4 pt-6 pb-32 sm:px-6 sm:pb-36 lg:pb-8">{children}</main>
      </div>
      <MobileNav role={role} />
    </div>
  );
}
