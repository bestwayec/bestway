// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

const toastMock = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const node = ns.split(".").reduce<any>((acc, part) => acc?.[part], en as any) ?? {};
    const template = key.split(".").reduce<any>((acc, part) => acc?.[part], node) ?? key;
    return typeof template === "string"
      ? template.replace(/\{(\w+)\}/g, (_: string, n: string) => String(values?.[n] ?? ""))
      : key;
  },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/lib/api-client", () => ({
  api: apiMock,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("a", { href, ...props }, children),
}));

import { GuardAlertsBell, TeacherGuardAlertsProvider } from "./teacher-guard-alerts";
import { BentoFeatures } from "@/components/marketing/bento-features";
import { HeroShowcase } from "@/components/marketing/hero-showcase";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  toastMock.warning.mockReset();
  toastMock.success.mockReset();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("TeacherGuardAlertsProvider & GuardAlertsBell", () => {
  it("renders guard bell for teacher with unread badge and allows acknowledge review", async () => {
    apiMock.get.mockResolvedValue({
      incidents: [
        {
          id: "inc-1",
          attemptId: "att-1",
          examId: "exam-1",
          examTitle: "IELTS Mock 1",
          studentId: "stu-1",
          studentName: "Aziza",
          groupId: "grp-1",
          groupName: "IELTS Advanced",
          sessionId: null,
          assignmentId: null,
          supervisorId: "t-1",
          eventType: "window_blur",
          severity: "warning",
          skill: "reading",
          questionRef: "Q12",
          integrityMode: "supervised_mock",
          occurrenceCount: 1,
          status: "new",
          offlineSynced: false,
          metadata: {},
          firstObservedAt: "2026-11-27T10:00:00Z",
          lastObservedAt: "2026-11-27T10:00:00Z",
          reviewedAt: null,
          reviewNote: "",
        },
      ],
      unreadCount: 1,
      seq: 1,
      serverTime: "2026-11-27T10:00:00Z",
    });
    apiMock.post.mockResolvedValue({
      id: "inc-1",
      status: "acknowledged",
      reviewedAt: "2026-11-27T10:00:05Z",
      reviewNote: "",
    });

    await act(async () => {
      root.render(
        React.createElement(TeacherGuardAlertsProvider, {
          role: "teacher",
          children: React.createElement(GuardAlertsBell),
        }),
      );
    });

    const bell = host.querySelector('[data-testid="guard-alerts-bell"]') as HTMLButtonElement;
    expect(bell).toBeTruthy();
    expect(bell.textContent).toContain("1");

    await act(async () => bell.click());
    expect(host.textContent).toContain("Aziza");
    expect(host.textContent).toContain("IELTS Advanced");

    const ackBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Acknowledge"),
    ) as HTMLButtonElement;
    expect(ackBtn).toBeTruthy();
    await act(async () => ackBtn.click());

    expect(apiMock.post).toHaveBeenCalledWith("/teacher/guard-alerts/inc-1/review", {
      status: "acknowledged",
      note: "",
    });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("hides guard bell for student role", async () => {
    await act(async () => {
      root.render(
        React.createElement(TeacherGuardAlertsProvider, {
          role: "student",
          children: React.createElement(GuardAlertsBell),
        }),
      );
    });
    expect(host.querySelector('[data-testid="guard-alerts-bell"]')).toBeNull();
    expect(apiMock.get).not.toHaveBeenCalled();
  });
});

describe("Landing HeroShowcase & BentoFeatures", () => {
  it("switches preview tabs and renders all six bento cards", async () => {
    await act(async () => {
      root.render(
        React.createElement("div", null, React.createElement(HeroShowcase), React.createElement(BentoFeatures)),
      );
    });
    expect(host.textContent).toContain("Reading · Passage 1");
    const teacherTab = [...host.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes("Teacher Workspace"),
    ) as HTMLButtonElement;
    expect(teacherTab).toBeTruthy();
    await act(async () => teacherTab.click());
    expect(host.textContent).toContain("IELTS Advanced · Live Guard & Grading");
    expect(host.textContent).toContain("Live Exam Guard 5.0");
    expect(host.textContent).toContain("Universal Classroom");
  });
});
