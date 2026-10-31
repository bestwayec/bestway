import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamifiedVideoPlayer } from "./GamifiedVideoPlayer";

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
});
