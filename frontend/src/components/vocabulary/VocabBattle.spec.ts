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

describe("VocabBattleHost podium", () => {
  let host: HTMLDivElement;
  let root: Root;
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows game scores only; claims no platform points the state does not report", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    apiPost.mockResolvedValue({ pin: "123456" });
    apiGet.mockResolvedValue({
      sessionId: "s", pin: "123456", setTitle: "Set", level: "B1", status: "FINISHED", currentQuestionIndex: 4, totalQuestions: 5,
      currentQuestion: null, answeredCount: 0, totalParticipants: 2,
      leaderboard: [{ id: "a", name: "Ali", score: 420, streak: 3 }, { id: "b", name: "Vali", score: 180, streak: 0 }],
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(React.createElement(VocabBattleHost, { setId: "set-1" })));
    const text = host.textContent ?? "";
    expect(text).toContain("G'oliblar podiumi");
    expect(text).toContain("Ali");
    expect(text).toContain("420 ochko");
    expect(text).toContain("Vali");
    expect(text).not.toMatch(/\+10|\+7|\+5|ball/);
  });
});
