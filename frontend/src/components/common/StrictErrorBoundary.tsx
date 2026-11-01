"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class StrictErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[StrictErrorBoundary] CRITICAL RENDER CRASH CAUGHT:", error);
    console.error("[StrictErrorBoundary] Component Stack:", errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  public handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      const error = this.state.error;
      const errorInfo = this.state.errorInfo;

      return (
        <div className="flex min-h-[400px] w-full items-center justify-center p-4 sm:p-8">
          {/* White Box for High Visibility Diagnostic */}
          <div className="w-full max-w-4xl rounded-2xl border-2 border-red-500 bg-white p-6 sm:p-8 text-slate-900 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-red-200 pb-4">
              <div className="grid size-10 place-items-center rounded-xl bg-red-100 text-red-600">
                <AlertTriangle className="size-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-red-700">
                  {this.props.fallbackTitle ?? "Critical Frontend Render Crash Caught"}
                </h2>
                <p className="text-xs text-slate-500">
                  An unhandled exception stopped this component from rendering. Diagnostic stack trace is displayed below.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {/* Error Message */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Error Message:
                </span>
                <p className="mt-1 rounded-lg bg-red-50 p-3 font-mono text-sm font-semibold text-red-800 border border-red-200">
                  {error?.message || "Unknown error occurred"}
                </p>
              </div>

              {/* Error Stack */}
              {error?.stack && (
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Error Stack:
                  </span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-400 border border-slate-800 whitespace-pre-wrap select-all">
                    {error.stack}
                  </pre>
                </div>
              )}

              {/* Component Stack */}
              {errorInfo?.componentStack && (
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Component Stack Trace:
                  </span>
                  <pre className="mt-1 max-h-36 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-300 border border-slate-800 whitespace-pre-wrap select-all">
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-red-700 transition-colors cursor-pointer"
              >
                <RotateCcw className="size-4" />
                Sahifani qayta yuklash (Reload)
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <RefreshCw className="size-4" />
                Komponentni qayta tiklash (Retry)
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
