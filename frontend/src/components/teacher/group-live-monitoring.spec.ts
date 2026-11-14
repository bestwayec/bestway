// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupLiveMonitoringData } from "@/lib/group-monitoring-types";

const fixture = vi.hoisted(() => ({
  data: {
    groupId: "group-1",
    groupName: "IELTS Intensive",
    activeCount: 1,
    students: [
      {
        studentId: "student-1",
        name: "Ali Valiyev",
        phone: "+998901234567",
        attemptId: "att-1",
        examId: "exam-1",
        examTitle: "Multilevel Mock Test 1",
        currentSection: "speaking",
        startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        timeActiveSeconds: 600,
        antiCheatCount: 2,
        anomalies: [
          { event: "exit_fullscreen", date: new Date().toISOString() },
          { event: "tab_switch", date: new Date().toISOString() },
        ],
      },
    ],
  } as GroupLiveMonitoringData | null,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

// Real messages: the page must read the same in both languages (Uzbek checked below).
const locale = vi.hoisted(() => ({ current: "uz" as "en" | "uz" }));
vi.mock("next-intl", async () => {
  const messages = { en: (await import("../../../messages/en.json")).default, uz: (await import("../../../messages/uz.json")).default } as Record<string, any>;
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = `${ns}.${key}`.split(".").reduce((node: any, part) => node?.[part], messages[locale.current]);
      return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_: string, n: string) => String(values?.[n] ?? "")) : key;
    },
  };
});

vi.mock("@/hooks/use-group-monitoring", () => ({
  useGroupLiveMonitoring: () => ({
    data: fixture.data,
    isLoading: fixture.isLoading,
    isError: fixture.isError,
    refetch: fixture.refetch,
    isFetching: false,
  }),
}));

import { GroupLiveMonitoring } from "./group-live-monitoring";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

describe("GroupLiveMonitoring", () => {
  it("renders live indicator, active students, current section, and anomaly alert badge", async () => {
    await React.act(async () => {
      root.render(React.createElement(GroupLiveMonitoring, { groupId: "group-1" }));
    });

    expect(container.textContent).toContain("Jonli imtihon kuzatuvi");
    expect(container.textContent).toContain("Jonli");
    expect(container.textContent).toContain("Ali Valiyev");
    expect(container.textContent).toContain("Speaking");
    expect(container.textContent).toContain("10 daqiqa 0 soniya ishlamoqda");
    // Recorded, never an accusation (phase 2 rule).
    expect(container.textContent).toContain("Qayd etildi: 2");
    expect(container.textContent).not.toMatch(/Qoidabuzarlik|🔴/);
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Qayd etildi"))!;
    await React.act(async () => open.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Imtihon jurnali");
    expect(dialog.textContent).toMatch(/to.liq ekrandan chiqdi/i);   // the exam log wording
  });

  it("shows safe status when anti-cheat count is 0", async () => {
    fixture.data = {
      groupId: "group-1",
      groupName: "IELTS Intensive",
      activeCount: 1,
      students: [
        {
          studentId: "student-2",
          name: "Vali Aliyev",
          attemptId: "att-2",
          examId: "exam-1",
          examTitle: "Multilevel Mock Test 1",
          currentSection: "writing",
          startedAt: new Date().toISOString(),
          timeActiveSeconds: 120,
          antiCheatCount: 0,
        },
      ],
    };

    await React.act(async () => {
      root.render(React.createElement(GroupLiveMonitoring, { groupId: "group-1" }));
    });

    expect(container.textContent).toContain("Hech narsa qayd etilmagan");
    expect(container.textContent).toContain("Writing");
    expect(container.textContent).not.toContain("Qayd etildi");
  });

  it("shows empty state when no students are active", async () => {
    fixture.data = {
      groupId: "group-1",
      groupName: "IELTS Intensive",
      activeCount: 0,
      students: [],
    };

    await React.act(async () => {
      root.render(React.createElement(GroupLiveMonitoring, { groupId: "group-1" }));
    });

    expect(container.textContent).toContain("Faol imtihon yo‘q");
  });

  it("reads in English on the English page", async () => {
    locale.current = "en";
    fixture.data = { groupId: "group-1", groupName: "IELTS Intensive", activeCount: 0, students: [] };
    await React.act(async () => {
      root.render(React.createElement(GroupLiveMonitoring, { groupId: "group-1" }));
    });
    expect(container.textContent).toContain("Live exam monitoring");
    expect(container.textContent).toContain("No exam in progress");
    expect(container.textContent).not.toMatch(/Jonli|yo‘q/);
    locale.current = "uz";
  });
});
