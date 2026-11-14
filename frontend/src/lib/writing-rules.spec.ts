// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clipboardDecision, countWords, resetInternalClipboard, WRITING_AREA_ATTRIBUTE } from "./writing-rules";

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["The chart shows two trends.", 5],
    ["A well-known, long-term plan.", 4],
    ["They don't agree; it's clear.", 5],
    ["In 2019 there were 3,500 visitors", 6],
    ["First - second ... third", 3],
    ["Line one\nline two\ttab", 5],
    ["Ўзбек тилида ҳам ишлайди", 4],
  ])("%j -> %i", (text, words) => {
    expect(countWords(text)).toBe(words);
  });
});

describe("clipboard in the timed exam", () => {
  let answer: HTMLTextAreaElement;
  let passage: HTMLParagraphElement;
  const data = (text: string) => ({ getData: () => text }) as unknown as DataTransfer;
  beforeEach(() => {
    resetInternalClipboard();
    document.body.innerHTML = `<div ${WRITING_AREA_ATTRIBUTE}><textarea>My own essay text here.</textarea></div><p>Reading passage</p>`;
    answer = document.querySelector("textarea")!;
    passage = document.querySelector("p")!;
  });

  it("text pasted from outside the exam is blocked", () => {
    expect(clipboardDecision("paste", { target: answer, clipboardData: data("a model essay from the internet") })).toBe("block");
  });

  it("copying exam content (outside the answer) is blocked", () => {
    expect(clipboardDecision("copy", { target: passage })).toBe("block");
    expect(clipboardDecision("paste", { target: passage, clipboardData: data("x") })).toBe("block");
  });

  it("the student may move their own text inside the answer", () => {
    answer.setSelectionRange(3, 12);   // "own essay"
    expect(clipboardDecision("cut", { target: answer })).toBe("allow");
    expect(clipboardDecision("paste", { target: answer, clipboardData: data("own essay") })).toBe("allow");
    expect(clipboardDecision("paste", { target: answer, clipboardData: data("something else") })).toBe("block");
  });
});
