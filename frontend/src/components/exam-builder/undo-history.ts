"use client";

import * as React from "react";

/**
 * Local edit history for an Exam Builder editor panel.
 *
 * Scope is deliberately local: it covers only the unsaved state of the open panel. Saving is a
 * version boundary (`reset`), and switching panels remounts the editor, so undo can never revert
 * content that is already on the server, another teacher's concurrent edit, or a published version.
 * Rapid successive changes (typing) within `coalesceMs` become one undo step.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Time of the last recorded change, for coalescing. */
  lastChangeAt: number;
}

export type HistoryAction<T> =
  | { type: "set"; value: T | ((prev: T) => T); at: number; coalesceMs: number; limit: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: T };

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastChangeAt: 0 };
}

export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case "set": {
      const next = typeof action.value === "function" ? (action.value as (prev: T) => T)(state.present) : action.value;
      if (Object.is(next, state.present)) return state;
      const coalesce = state.past.length > 0 && action.at - state.lastChangeAt < action.coalesceMs;
      const past = coalesce ? state.past : [...state.past, state.present].slice(-action.limit);
      return { past, present: next, future: [], lastChangeAt: action.at };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], lastChangeAt: 0 };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest, lastChangeAt: 0 };
    }
    case "reset":
      return createHistory(action.value);
  }
}

export interface UndoableState<T> {
  value: T;
  /** Record a change (typing bursts are merged into one step). */
  set: (value: T | ((prev: T) => T)) => void;
  /** Replace the value and forget history (after a save or a reload from the server). */
  reset: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoableState<T>(initial: T | (() => T), { coalesceMs = 600, limit = 100 } = {}): UndoableState<T> {
  const [state, dispatch] = React.useReducer(
    historyReducer as (s: History<T>, a: HistoryAction<T>) => History<T>,
    undefined,
    () => createHistory(typeof initial === "function" ? (initial as () => T)() : initial),
  );
  const set = React.useCallback(
    (value: T | ((prev: T) => T)) => dispatch({ type: "set", value, at: Date.now(), coalesceMs, limit }),
    [coalesceMs, limit],
  );
  const reset = React.useCallback((value: T) => dispatch({ type: "reset", value }), []);
  const undo = React.useCallback(() => dispatch({ type: "undo" }), []);
  const redo = React.useCallback(() => dispatch({ type: "redo" }), []);
  return { value: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

/** True when a keyboard event belongs to a text field, whose native undo must keep working. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return false;
}

export type ShortcutAction = "undo" | "redo" | null;

/** Ctrl/⌘+Z → undo, Ctrl/⌘+Shift+Z or Ctrl+Y → redo; ignored inside text fields (native undo). */
export function shortcutFor(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target">): ShortcutAction {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (isTextEditingTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}
