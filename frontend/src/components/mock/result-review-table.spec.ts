// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    type Tree = { [key: string]: Tree | string | undefined };
    const node = namespace.split(".").reduce<Tree | undefined>((tree, part) => tree?.[part] as Tree | undefined, en as unknown as Tree);
    const template = typeof node?.[key] === "string" ? (node[key] as string) : key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""));
  },
}));
import { filterReviewRows, ResultReviewTable } from "./result-review-table";
import type { MockAttemptQuestion } from "@/lib/types";

const q = (n: number, response: string, isCorrect: boolean | null, key?: string[]) =>
  ({ id: `q${n}`, number: 40 + n, displayNumber: n, type: "short_answer", prompt: `Prompt ${n}`, response, isCorrect, correctAnswers: key }) as unknown as MockAttemptQuestion;
const QUESTIONS = [q(1, "alpha", true, ["alpha"]), q(2, "beta", false, ["gamma"]), q(3, "", false, ["delta"]), q(4, "  ", false)];

describe("filterReviewRows", () => {
  it("keeps marked-wrong answers under Wrong and empty answers under Unanswered", () => {
    expect(filterReviewRows(QUESTIONS, "all")).toHaveLength(4);
    expect(filterReviewRows(QUESTIONS, "wrong").map((x) => x.id)).toEqual(["q2"]);
    expect(filterReviewRows(QUESTIONS, "unanswered").map((x) => x.id)).toEqual(["q3", "q4"]);
  });
});

describe("ResultReviewTable", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(ResultReviewTable, { title: "Reading", questions: QUESTIONS })));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const rows = () => [...host.querySelectorAll("tbody tr")];
  const button = (label: RegExp) => [...host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""))!;

  it("shows the paper numbers, the score and the counts on the filters", () => {
    expect(rows().map((r) => r.querySelector("td")!.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(host.textContent).toContain("1 of 4 correct");
    expect(button(/^Wrong/).textContent).toBe("Wrong (1)");
    expect(button(/^Unanswered/).textContent).toBe("Unanswered (2)");
  });

  it("filters to wrong and unanswered rows, and shows a dash when no key was sent", async () => {
    await act(async () => button(/^Wrong/).click());
    expect(rows().map((r) => r.getAttribute("data-review-state"))).toEqual(["wrong"]);
    expect(rows()[0].textContent).toContain("gamma");
    await act(async () => button(/^Unanswered/).click());
    expect(rows().map((r) => r.getAttribute("data-review-state"))).toEqual(["unanswered", "unanswered"]);
    expect(rows()[1].textContent).toContain("No answer");
    expect(rows()[1].textContent).toContain("—");
    expect(button(/^Unanswered/).getAttribute("aria-pressed")).toBe("true");
  });
});
