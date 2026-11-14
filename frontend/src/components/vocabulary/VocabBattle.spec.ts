// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const uz = (await import("../../../messages/uz.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), uz);
  const t = (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const found = lookup(`${ns}.${key}`);
    return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
  };
  return { useTranslations: t };
});
const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({ api: { post: (...a: unknown[]) => apiPost(...a), get: (...a: unknown[]) => apiGet(...a) } }));

import { VocabBattlePlayer } from "./VocabBattlePlayer";
import { VocabBattleHost } from "./VocabBattleHost";

describe("VocabBattlePlayer component", () => {
  it("renders the PIN entry form from messages, without an example PIN", () => {
    const html = renderToStaticMarkup(React.createElement(VocabBattlePlayer, { initialPin: "" }));
    expect(html).toContain("Vocab Battle o&#x27;yiniga kirish");
    expect(html).toContain("6 xonali PIN-kodni kiriting");
    expect(html).not.toMatch(/\d{6}/);
  });

  it("renders the initial PIN when provided", () => {
    const html = renderToStaticMarkup(React.createElement(VocabBattlePlayer, { initialPin: "123456" }));
    expect(html).toContain("123456");
  });
});

const BOARD = [{ id: "a", name: "Ali", score: 420, streak: 3 }, { id: "b", name: "Vali", score: 180, streak: 0 }, { id: "z", name: "Nol", score: 0, streak: 0 }];
const finished = (extra: Record<string, unknown>) => ({
  sessionId: "s", pin: "123456", setTitle: "Set", level: "B1", status: "FINISHED", currentQuestionIndex: 4, totalQuestions: 5,
  currentQuestion: null, answeredCount: 0, totalParticipants: 3, leaderboard: BOARD, ...extra,
});

describe("VocabBattle podium", () => {
  let host: HTMLDivElement;
  let root: Root;
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  async function mount(element: React.ReactElement) {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(element));
    await act(async () => { await Promise.resolve(); });
    return host.textContent ?? "";
  }
  async function hostText(state: Record<string, unknown>) {
    apiPost.mockResolvedValue({ pin: "123456" });
    apiGet.mockResolvedValue(state);
    return mount(React.createElement(VocabBattleHost, { setId: "set-1" }));
  }

  it("older API without winners: game scores only, no platform points claimed", async () => {
    const text = await hostText(finished({}));
    expect(text).toContain("G'oliblar podiumi");
    expect(text).toContain("Ali");
    expect(text).toContain("420 ochko");
    expect(text).toContain("Vali");
    expect(text).not.toMatch(/\+10|\+7|\+5|ball/);
  });

  it("shows the points the server recorded for each winner, and only those", async () => {
    const text = await hostText(finished({ winners: [
      { rank: 1, studentId: "a", name: "Ali", score: 420, pointsAwarded: 10 },
      { rank: 2, studentId: "b", name: "Vali", score: 180, pointsAwarded: 0 },
    ] }));
    expect(text).toContain("+10 ball qo'shildi");
    expect(text.match(/ball qo'shildi/g)).toHaveLength(1);
    expect(text).not.toContain("+7");
    // A player without a game score is not on the podium.
    expect(text).not.toContain("Nol");
  });

  it("an empty winners list shows no podium and no points", async () => {
    const text = await hostText(finished({ winners: [] }));
    expect(text).toContain("hech kim ochko to'plamadi");
    expect(text).not.toContain("Ali");
    expect(text).not.toMatch(/ball qo'shildi/);
  });

  async function playerText(winners: unknown) {
    apiPost.mockResolvedValue(finished({ myState: { id: "b", name: "Vali", score: 180, streak: 0 }, ...(winners === undefined ? {} : { winners }) }));
    return mount(React.createElement(VocabBattlePlayer, { initialPin: "123456" }));
  }

  it("player sees the place and points the server recorded for them", async () => {
    const text = await playerText([{ rank: 1, studentId: "a", name: "Ali", score: 420, pointsAwarded: 10 }, { rank: 2, studentId: "b", name: "Vali", score: 180, pointsAwarded: 7 }]);
    expect(text).toContain("O'rningiz: 2-o'rin");
    expect(text).toContain("+7 ball qo'shildi");
    expect(text).not.toContain("+10");
  });

  it("player off the podium, with no award, or on an older API sees no points message", async () => {
    for (const winners of [[{ rank: 1, studentId: "a", name: "Ali", score: 420, pointsAwarded: 10 }], [{ rank: 1, studentId: "b", name: "Vali", score: 180, pointsAwarded: 0 }], undefined]) {
      const text = await playerText(winners);
      expect(text).toContain("180 ochko");
      expect(text).not.toMatch(/ball qo'shildi/);
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
