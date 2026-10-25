"use client";

import * as React from "react";
import {
  Award,
  Crown,
  Gamepad2,
  Lock,
  Plus,
  Search,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BamboozleArena, BamboozleCard } from "./BamboozleArena";
import { QuizDeckCreator } from "./QuizDeckCreator";

export interface QuizDeckItem {
  id: string;
  title: string;
  category: string;
  is_lesson_tied: boolean;
  lesson_id?: string | null;
  lesson_title?: string | null;
  card_count: number;
  created_at: string;
  is_unlocked?: boolean;
}

export function BamboozleLobby() {
  const { data: me } = useMe();
  const role = me?.user?.role;
  const canManageDecks = ["teacher", "admin", "super_admin"].includes(role || "");

  const [decks, setDecks] = React.useState<QuizDeckItem[]>([]);
  const [selectedCategory, setSelectedCategory] = React.useState<string>("All");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);

  // Active game arena state
  const [activeDeck, setActiveDeck] = React.useState<{
    title: string;
    category: string;
    cards: BamboozleCard[];
  } | null>(null);

  // Creator modal
  const [isCreatorOpen, setIsCreatorOpen] = React.useState(false);

  const fetchDecks = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<any>("/v1/quiz-decks");
      const list = res.data?.data || res.data || [];
      setDecks(list);
    } catch {
      // Fallback sample decks if empty
      setDecks([
        {
          id: "demo-deck-1",
          title: "IELTS Band 7+ Essential Vocabulary",
          category: "Vocabulary",
          is_lesson_tied: false,
          card_count: 16,
          created_at: new Date().toISOString(),
          is_unlocked: true,
        },
        {
          id: "demo-deck-2",
          title: "Advanced Grammar & Inversions",
          category: "Grammar",
          is_lesson_tied: false,
          card_count: 16,
          created_at: new Date().toISOString(),
          is_unlocked: true,
        },
        {
          id: "demo-deck-3",
          title: "Fluency & Coherence Practice",
          category: "IELTS",
          is_lesson_tied: true,
          lesson_title: "1-Dars: Speaking Fluency",
          card_count: 16,
          created_at: new Date().toISOString(),
          is_unlocked: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  const handleStartGame = async (deck: QuizDeckItem) => {
    try {
      const res = await api.get<any>(`/v1/quiz-decks/${deck.id}`);
      const data = res.data?.data || res.data || {};
      const rawCards = data.cards || [];

      // If no cards from API, generate 16 game cards
      let gameCards: BamboozleCard[] = rawCards;
      if (gameCards.length === 0) {
        const types: ("question" | "swap" | "steal" | "double" | "bomb")[] = [
          "question", "question", "swap", "question",
          "question", "steal", "question", "double",
          "question", "bomb", "question", "question",
          "question", "swap", "question", "bomb",
        ];
        gameCards = types.map((t, idx) => ({
          id: `card-${idx + 1}`,
          order_index: idx + 1,
          card_type: t,
          points: t === "question" ? [10, 15, 20][idx % 3] : 0,
          question_text:
            t === "question"
              ? `Savol #${idx + 1}: What is the primary meaning of context #${idx + 1}?`
              : t.toUpperCase(),
          options: ["Option A", "Option B", "Option C", "Option D"],
          correct_answer: "Option A",
        }));
      }

      setActiveDeck({
        title: deck.title,
        category: deck.category,
        cards: gameCards,
      });
    } catch {
      // Fallback start with generated cards
      setActiveDeck({
        title: deck.title,
        category: deck.category,
        cards: Array.from({ length: 16 }).map((_, i) => ({
          id: `demo-${i}`,
          order_index: i + 1,
          card_type: i === 2 || i === 13 ? "swap" : i === 5 ? "steal" : i === 7 ? "double" : i === 9 || i === 15 ? "bomb" : "question",
          points: [10, 15, 20][i % 3],
          question_text: `Savol #${i + 1}: Define the target vocabulary concept?`,
          options: ["Option 1", "Option 2", "Option 3", "Option 4"],
          correct_answer: "Option 1",
        })),
      });
    }
  };

  if (activeDeck) {
    return (
      <BamboozleArena
        deckTitle={activeDeck.title}
        category={activeDeck.category}
        cards={activeDeck.cards}
        onExit={() => setActiveDeck(null)}
      />
    );
  }

  const categories = ["All", "Vocabulary", "Grammar", "IELTS", "General"];

  const filteredDecks = decks.filter((d) => {
    const matchesCat = selectedCategory === "All" || d.category.toLowerCase() === selectedCategory.toLowerCase();
    const matchesSearch = d.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="w-full space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950/60 via-[#0B0F17] to-slate-900 border border-emerald-500/20 p-6 sm:p-8">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                Bamboozle Team Arena
              </Badge>
              <Badge variant="neutral" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                2 Jamoa Bellashuvi
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white">Bamboozle Jamoalar Jangi Maydoni</h1>
            <p className="text-sm text-slate-300 max-w-xl mt-1">
              Sinfxonada yoki do&apos;stlar bilan 2 jamoaga bo&apos;linib, qiziqarli syurpriz kartalar va savollar bilan bilimingizni sinang.
            </p>
          </div>

          {canManageDecks && (
            <Button
              type="button"
              onClick={() => setIsCreatorOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Yangi Deck Yaratish</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSelectedCategory(c)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                selectedCategory === c
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Deck nomini qidirish..."
            className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Decks Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse" />
          ))}
        </div>
      ) : filteredDecks.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/30 rounded-2xl border border-slate-800">
          <Gamepad2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h4 className="text-base font-bold text-white mb-1">To&apos;plamlar Topilmadi</h4>
          <p className="text-xs text-slate-400 mb-4">Ushbu kategoriya bo&apos;yicha hali quiz to&apos;plamlari mavjud emas.</p>
          {canManageDecks && (
            <Button
              type="button"
              size="sm"
              onClick={() => setIsCreatorOpen(true)}
              className="bg-emerald-500 text-slate-950 font-bold text-xs"
            >
              Birinchi bo&apos;lib to&apos;plam yarating
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDecks.map((deck) => {
            const isLocked = deck.is_lesson_tied && deck.is_unlocked === false;

            return (
              <div
                key={deck.id}
                className="p-5 rounded-2xl bg-[#0B0F17] border border-slate-800 hover:border-emerald-500/40 transition-all flex flex-col justify-between group shadow-lg"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="neutral" className="bg-emerald-500/10 text-emerald-400 text-xs">
                      {deck.category}
                    </Badge>
                    <span className="text-xs font-mono text-slate-400">
                      {deck.card_count || 16} ta karta
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                    {deck.title}
                  </h3>

                  {deck.is_lesson_tied && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-3">
                      {isLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Sparkles className="w-3.5 h-3.5 text-emerald-400" />}
                      <span className="truncate">{deck.lesson_title || "Darsga biriktirilgan"}</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-800/80">
                  <Button
                    type="button"
                    disabled={isLocked}
                    onClick={() => handleStartGame(deck)}
                    className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 ${
                      isLocked
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                    }`}
                  >
                    {isLocked ? (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>Dars Ko&apos;rilgach Ochiladi</span>
                      </>
                    ) : (
                      <>
                        <Swords className="w-4 h-4" />
                        <span>Jamoalar Jangini Boshlash</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Creator Modal */}
      {isCreatorOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <QuizDeckCreator
            onCancel={() => setIsCreatorOpen(false)}
            onSuccess={() => {
              setIsCreatorOpen(false);
              fetchDecks();
            }}
          />
        </div>
      )}
    </div>
  );
}
