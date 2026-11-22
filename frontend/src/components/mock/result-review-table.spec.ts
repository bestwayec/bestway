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
import type { MockAttemptGroup, MockAttemptQuestion } from "@/lib/types";

const q = (n: number, response: string, isCorrect: boolean | null, key?: string[]) =>
  ({ id: `q${n}`, number: 40 + n, displayNumber: n, type: "short_answer", prompt: `Prompt ${n}`, response, isCorrect, correctAnswers: key }) as unknown as MockAttemptQuestion;
const QUESTIONS = [q(1, "alpha", true, ["alpha"]), q(2, "beta", false, ["gamma"]), q(3, "", false, ["delta"]), q(4, "  ", false)];
const PASSAGE = "Alpha was first. The answer to two is gamma, said the text. Delta came last.";
(QUESTIONS[1] as { evidence?: unknown }).evidence = { text: "The answer to two is gamma", offset: PASSAGE.indexOf("The answer") };
const GROUP = { id: "g1", title: "Passage 1", instructions: null, passageText: PASSAGE, hasAudio: false, questions: QUESTIONS } as unknown as MockAttemptGroup;

describe("filterReviewRows", () => {
  it("keeps marked-wrong answers under Wrong and empty answers under Unanswered", () => {
    expect(filterReviewRows(QUESTIONS, "all")).toHaveLength(4);
    expect(filterReviewRows(QUESTIONS, "wrong").map((x) => x.id)).toEqual(["q2"]);
    expect(filterReviewRows(QUESTIONS, "unanswered").map((x) => x.id)).toEqual(["q3", "q4"]);
    expect(filterReviewRows(QUESTIONS, "correct").map((x) => x.id)).toEqual(["q1"]);
    expect(filterReviewRows(QUESTIONS, "flagged", new Set(["q2", "q4"])).map((x) => x.id)).toEqual(["q2", "q4"]);
  });
});

describe("ResultReviewTable", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(ResultReviewTable, { title: "Reading", skill: "reading", groups: [GROUP] })));
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

  it("shows the key on every question the server sent one for, not only on wrong answers", () => {
    const keyCell = (i: number) => rows()[i].querySelectorAll("td")[3].textContent;
    expect([0, 1, 2, 3].map(keyCell)).toEqual(["alpha", "gamma", "delta", "—"]);
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

  it("clicking a wrong answer shows where the answer is, highlighted in the passage", async () => {
    expect(host.querySelector('[data-testid="review-explain"]')).toBeNull();
    expect(rows()[0].querySelector("button[aria-expanded]")).toBeNull();          // nothing marked: no button
    await act(async () => (rows()[1] as HTMLTableRowElement).click());
    const mark = host.querySelector('[data-testid="review-evidence"]');
    expect(mark?.textContent).toBe("The answer to two is gamma");
    expect(host.querySelector('[role="region"]')?.textContent).toBe(PASSAGE);
    expect(rows()[1].querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => (rows()[1] as HTMLTableRowElement).click());
    expect(host.querySelector('[data-testid="review-explain"]')).toBeNull();
  });

  it("renders multi-passage grouping and flagged items when provided", async () => {
    const group2 = {
      id: "g2",
      title: "Passage 2",
      instructions: null,
      passageText: "Passage 2 text",
      hasAudio: false,
      questions: [q(5, "zeta", true, ["zeta"])],
    } as unknown as MockAttemptGroup;

    await act(async () =>
      root.render(
        React.createElement(ResultReviewTable, {
          title: "Reading",
          skill: "reading",
          groups: [GROUP, group2],
          flaggedIds: new Set(["q2"]),
        }),
      ),
    );

    expect(host.textContent).toContain("Passage 1");
    expect(host.textContent).toContain("Passage 2");
    expect(button(/^Flagged/).textContent).toBe("Flagged (1)");
    await act(async () => button(/^Flagged/).click());
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector("td")!.textContent).toContain("2");
  });
});
