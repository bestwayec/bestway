import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BamboozleArena, BamboozleCard } from "./BamboozleArena";

describe("BamboozleArena Component", () => {
  const mockCards: BamboozleCard[] = [
    {
      id: "card-1",
      order_index: 1,
      card_type: "question",
      points: 15,
      question_text: "What does 'lucid' mean?",
      options: ["Clear", "Dark", "Noisy", "Heavy"],
      correct_answer: "Clear",
    },
    {
      id: "card-2",
      order_index: 2,
      card_type: "swap",
      points: 0,
      question_text: "SWAP!",
    },
    {
      id: "card-3",
      order_index: 3,
      card_type: "bomb",
      points: 0,
      question_text: "BOMB!",
    },
  ];

  it("renders arena title, category, and team scoreboards", () => {
    const html = renderToStaticMarkup(
      React.createElement(BamboozleArena, {
        deckTitle: "IELTS Speaking Deck",
        category: "Vocabulary",
        cards: mockCards,
      })
    );

    expect(html).toContain("IELTS Speaking Deck");
    expect(html).toContain("Vocabulary");
    expect(html).toContain("Team 1");
    expect(html).toContain("Team 2");
    expect(html).toContain("Proyektor Rejimi");
  });

  it("renders card numbers and team 1 starting turn", () => {
    const html = renderToStaticMarkup(
      React.createElement(BamboozleArena, {
        deckTitle: "Test Arena",
        cards: mockCards,
      })
    );

    expect(html).toContain("Navbat");
    expect(html).toContain("Karta");
  });
});
