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

    expect(container.textContent).toContain("Jonli Imtihon Monitoringi");
    expect(container.textContent).toContain("Jonli efirda kuzatish");
    expect(container.textContent).toContain("Ali Valiyev");
    expect(container.textContent).toContain("Speaking");
    expect(container.textContent).toContain("Qoidabuzarlik: 2 marta!");
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

    expect(container.textContent).toContain("Xavfsiz rejimda");
    expect(container.textContent).toContain("Writing");
    expect(container.textContent).not.toContain("Qoidabuzarlik");
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

    expect(container.textContent).toContain("Hozirda faol imtihon yo'q");
  });
});
