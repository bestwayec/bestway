import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VocabBattlePlayer } from "./VocabBattlePlayer";

describe("VocabBattlePlayer component", () => {
  it("renders PIN entry form initially when no PIN is joined", () => {
    const html = renderToStaticMarkup(
      React.createElement(VocabBattlePlayer, {
        initialPin: "",
      })
    );

    expect(html).toContain("Vocab Battle O&#x27;yiniga Kirish");
    expect(html).toContain("PIN-kodni kiriting");
  });

  it("renders initial PIN when provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(VocabBattlePlayer, {
        initialPin: "742918",
      })
    );

    expect(html).toContain("742918");
  });
});
