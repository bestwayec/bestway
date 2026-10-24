import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClickToVocabWrapper } from "./ClickToVocabWrapper";

describe("ClickToVocabWrapper component", () => {
  it("renders interactive word tokens from plain text", () => {
    const html = renderToStaticMarkup(
      React.createElement(ClickToVocabWrapper, {
        text: "The environment requires sustainable development and vocabulary practice.",
      })
    );

    expect(html).toContain("environment");
    expect(html).toContain("sustainable");
    expect(html).toContain("development");
    expect(html).toContain("cursor-pointer");
  });

  it("renders sentences with timestamps and audio seek buttons for listening", () => {
    const sentences = [
      { text: "Good morning everyone, welcome to the test.", timestamp: 12 },
      { text: "Please listen carefully to the following recording.", timestamp: 45 },
    ];

    const html = renderToStaticMarkup(
      React.createElement(ClickToVocabWrapper, {
        sentencesWithTimestamps: sentences,
        onSeekAudio: () => {},
      })
    );

    expect(html).toContain("0:12");
    expect(html).toContain("0:45");
    expect(html).toContain("Good");
    expect(html).toContain("morning");
    expect(html).toContain("listen");
    expect(html).toContain("carefully");
  });
});
