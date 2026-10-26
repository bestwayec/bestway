import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LessonQuizModal } from "./LessonQuizModal";

describe("LessonQuizModal Component", () => {
  it("renders when closed without crashing", () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonQuizModal, {
        isOpen: false,
        onClose: () => {},
        lessonId: "lesson-1",
        lessonTitle: "1. Nouns: Countable & Uncountable",
      })
    );

    expect(html).toBeDefined();
  });

  it("exports valid React component function", () => {
    expect(typeof LessonQuizModal).toBe("function");
  });
});
