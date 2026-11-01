"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled render error:", error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 p-6 text-center text-fg">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/20 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-fg">
            {this.props.fallbackTitle ?? "Topshiriqni yuklashda xatolik yuz berdi"}
          </h3>
          <p className="mt-1 max-w-md text-xs text-fg-muted">
            {this.props.fallbackMessage ?? this.state.error?.message ?? "Ushbu bo'limni ko'rsatishda kutilmagan xatolik yuz berdi. Iltimos, qayta urinib ko'ring yoki keyingi bo'limga o'ting."}
          </p>
          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={this.handleReset}
              className="gap-2 cursor-pointer"
            >
              <RefreshCw className="size-3.5" />
              Qayta urinish
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
