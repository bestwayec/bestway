import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamifiedVideoPlayer, isStreamTruncated } from "./GamifiedVideoPlayer";

describe("GamifiedVideoPlayer Component", () => {
  it("renders video element with title and anti-cheat indicators", () => {
    const html = renderToStaticMarkup(
      React.createElement(GamifiedVideoPlayer, {
        src: "/api/v1/lessons/lesson-1/stream",
        lessonId: "lesson-1",
        lessonTitle: "Speaking Tactics Part 1",
        lessonDuration: 120,
        xpReward: 50,
      })
    );

    expect(html).toContain("Speaking Tactics Part 1");
    expect(html).toContain("+50 XP");
    expect(html).toContain("LMS Protected");
    expect(html).toContain("<video");
    expect(html).toContain("Darsni boshlash");
    expect(html).not.toContain("Video yuklanmoqda...");
  });

  it("renders custom XP reward when provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(GamifiedVideoPlayer, {
        src: "/api/v1/lessons/lesson-2/stream",
        lessonId: "lesson-2",
        lessonTitle: "Advanced Collocations",
        xpReward: 100,
      })
    );

    expect(html).toContain("+100 XP");
    expect(html).toContain("Advanced Collocations");
  });

  it("never renders the tab-switch 'Dars Pauzada' blocker", () => {
    const html = renderToStaticMarkup(
      React.createElement(GamifiedVideoPlayer, {
        src: "/api/v1/lessons/lesson-3/stream",
        lessonId: "lesson-3",
        lessonTitle: "Numerals",
        lessonDuration: 1097,
      })
    );

    expect(html).not.toContain("Dars Pauzada");
    expect(html).not.toContain("Boshqa oynaga");
  });
});

describe("isStreamTruncated", () => {
  it("flags a 6s placeholder stream for a 1097s lesson", () => {
    expect(isStreamTruncated(6, 1097)).toBe(true);
  });

  it("flags a stream covering less than 80% of the lesson", () => {
    expect(isStreamTruncated(800, 1097)).toBe(true);
  });

  it("accepts a complete stream", () => {
    expect(isStreamTruncated(1097.2, 1097)).toBe(false);
    expect(isStreamTruncated(1090, 1097)).toBe(false);
  });

  it("ignores unknown or tiny lesson durations and invalid media durations", () => {
    expect(isStreamTruncated(6, 0)).toBe(false);
    expect(isStreamTruncated(6, 20)).toBe(false);
    expect(isStreamTruncated(Number.NaN, 1097)).toBe(false);
    expect(isStreamTruncated(Number.POSITIVE_INFINITY, 1097)).toBe(false);
    expect(isStreamTruncated(0, 1097)).toBe(false);
  });
});
