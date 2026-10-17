// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentJobView, AttemptAssessments } from "@/lib/assessment-types";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
import { useAttemptAssessments, useReviewAssessment } from "./use-assessment";
import { useGradeMock } from "./use-mock";

let client: QueryClient;
let host: HTMLDivElement;
let root: Root;
let ledger: AttemptAssessments;
let score: number | null;
let summaryReads: ReturnType<typeof vi.fn>;
let rankingReads: ReturnType<typeof vi.fn>;

function job(status: AssessmentJobView["status"], version = 1, finalScore: number | null = null): AssessmentJobView {
  return { id: "job", version, status, finalScore, finalScoreSource: finalScore == null ? null : "AI" } as AssessmentJobView;
}

function Probe() {
  const assessments = useAttemptAssessments("attempt");
  const review = useReviewAssessment("attempt", "job");
  const grade = useGradeMock("attempt");
  const summary = useQuery({ queryKey: ["mock-attempt", "attempt"], queryFn: summaryReads });
  useQuery({ queryKey: ["mock-attempts", "all"], queryFn: summaryReads });
  useQuery({ queryKey: ["mock-attempts-mine", "student"], queryFn: summaryReads });
  const ranking = useQuery({ queryKey: ["group-ai-ranking", "group", "exam", "writing"], queryFn: rankingReads });
  return React.createElement("div", {},
    React.createElement("span", { id: "summary" }, String(summary.data?.score ?? "pending")),
    React.createElement("span", { id: "ranking" }, String(ranking.data?.score ?? "pending")),
    React.createElement("span", { id: "assessment" }, String(assessments.data?.assessments[0]?.finalScore ?? "pending")),
    React.createElement("button", { id: "review", onClick: () => review.mutate({ action: "OVERRIDE", expectedVersion: 1, reason: "Teacher review" }) }, "review"),
    React.createElement("button", { id: "grade", onClick: () => grade.mutate({ questionId: "question", score: 4 }) }, "grade"));
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
}
async function mount() {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe))));
  await settle();
}
async function refreshLedger() {
  await act(async () => { await client.invalidateQueries({ queryKey: ["attempt-assessments", "attempt"] }); });
  await settle();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  score = null; ledger = { attemptId: "attempt", assessments: [job("PROCESSING")] };
  summaryReads = vi.fn(async () => ({ score })); rankingReads = vi.fn(async () => ({ score }));
  apiMock.get.mockReset().mockImplementation(async () => structuredClone(ledger));
  apiMock.post.mockReset().mockResolvedValue({ saved: true });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove();
});

describe("assessment and saved score synchronization", () => {
  it("refreshes the actual attempt, lists and group ranking when the worker finishes", async () => {
    await mount();
    expect(summaryReads).toHaveBeenCalledTimes(3); expect(rankingReads).toHaveBeenCalledTimes(1);
    score = 44; ledger.assessments = [job("SUCCEEDED", 2, score)];
    await refreshLedger();
    expect(host.querySelector("#assessment")?.textContent).toBe("44");
    expect(host.querySelector("#summary")?.textContent).toBe("44");
    expect(host.querySelector("#ranking")?.textContent).toBe("44");
    expect(summaryReads).toHaveBeenCalledTimes(6); expect(rankingReads).toHaveBeenCalledTimes(2);
    await refreshLedger();
    expect(summaryReads).toHaveBeenCalledTimes(6); expect(rankingReads).toHaveBeenCalledTimes(2);
  });

  it("refreshes a cached summary when writing finished before the first request while speaking is still running", async () => {
    client.setQueryData(["mock-attempt", "attempt"], { score: null });
    client.setQueryData(["group-ai-ranking", "group", "exam", "writing"], { score: null });
    score = 43; ledger.assessments = [job("SUCCEEDED", 2, score), { ...job("PROCESSING"), id: "speaking" }];
    await mount();
    expect(host.querySelector("#summary")?.textContent).toBe("43");
    expect(host.querySelector("#ranking")?.textContent).toBe("43");
  });

  it.each(["review", "grade"])("refreshes the group ranking immediately after a teacher %s, even if the assessment ledger is unchanged", async (action) => {
    await mount();
    score = 47;
    await act(async () => host.querySelector<HTMLButtonElement>(`#${action}`)!.click());
    await settle();
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(host.querySelector("#ranking")?.textContent).toBe("47");
    expect(host.querySelector("#summary")?.textContent).toBe("47");
  });
});
