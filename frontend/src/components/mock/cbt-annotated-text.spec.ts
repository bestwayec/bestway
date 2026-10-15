import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CbtAnnotatedText } from "./cbt-annotated-text";

describe("CbtAnnotatedText component", () => {
  it("renders text without crashing", () => {
    const html = renderToStaticMarkup(
      React.createElement(CbtAnnotatedText, {
        text: "This is a reading passage text for testing CBT highlights and underlines.",
        storageKey: "test.group1.passage",
      })
    );

    expect(html).toContain("This is a reading passage text");
  });

  it("splits paragraphs by double newline and renders multiple paragraphs", () => {
    const sampleText = "Paragraph 1 with important details.\n\nParagraph 2 with extra notes.";
    const html = renderToStaticMarkup(
      React.createElement(CbtAnnotatedText, {
        text: sampleText,
        storageKey: "test.group2.passage",
      })
    );

    expect(html).toContain("Paragraph 1 with important details.");
    expect(html).toContain("Paragraph 2 with extra notes.");
  });
});
