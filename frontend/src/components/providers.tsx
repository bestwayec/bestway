"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
import { AUTH_CONTEXT_STORAGE } from "@/lib/auth-context";
import { ApiError } from "@/lib/api-client";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // 4xx — qayta urinishdan foyda yo'q (ruxsat yo'q, topilmadi, validatsiya)
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  // Brauzerda bitta klient — React yangi render'da uni qayta yaratmasin
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  React.useEffect(() => {
    function sessionChanged(event: StorageEvent) {
      if (event.key !== AUTH_CONTEXT_STORAGE || !event.newValue) return;
      queryClient.clear();
      window.location.reload();
    }
    window.addEventListener("storage", sessionChanged);
    return () => window.removeEventListener("storage", sessionChanged);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" storageKey="theme" disableTransitionOnChange>
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            classNames: {
              toast: "!bg-surface !text-fg !border-border !rounded-card !shadow-e2 !font-sans",
              description: "!text-fg-muted",
              success: "!text-success",
              error: "!text-danger",
            },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
