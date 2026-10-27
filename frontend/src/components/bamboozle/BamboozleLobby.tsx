"use client";

import * as React from "react";
import {
  Award,
  Check,
  Copy,
  Crown,
  Gamepad2,
  Lock,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useRouter, useSearchParams } from "next/navigation";
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
    roomCode?: string;
    shareUrl?: string;
    telegramShareUrl?: string;
    team1Name?: string;
    team2Name?: string;
  } | null>(null);

  // 1v1 Room Challenge modal state
  const [challengeModal, setChallengeModal] = React.useState<{
    roomCode: string;
    deckId: string;
    deckTitle: string;
    shareUrl: string;
    telegramShareUrl: string;
    cards: BamboozleCard[];
  } | null>(null);
  const [isCopied, setIsCopied] = React.useState(false);

  // Creator modal
  const [isCreatorOpen, setIsCreatorOpen] = React.useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDeckId = searchParams?.get("deck");
  const requestedRoom = searchParams?.get("room");

  // Auto-connect if room param is present
  React.useEffect(() => {
    if (requestedRoom) {
      (async () => {
        try {
          setIsLoading(true);
          const res = await api.get<any>(`/v1/bamboozle/rooms/${requestedRoom}`);
          const roomData = res?.data?.data || res?.data || res;
          if (roomData && Array.isArray(roomData.cards)) {
            setActiveDeck({
              title: roomData.deck_title || "Bamboozle 1v1 Jang",
              category: roomData.category || "Grammar",
              cards: roomData.cards,
              roomCode: roomData.room_code,
              shareUrl: roomData.share_url,
              telegramShareUrl: roomData.telegram_share_url,
              team1Name: roomData.team1_name || "O'yinchi 1",
              team2Name: me?.user?.name || roomData.team2_name || "Do'st",
            });
          }
        } catch (e) {
          console.error("Room fetch error:", e);
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, [requestedRoom, me]);

  const fetchDecks = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<any>("/v1/quiz-decks");
      const list: QuizDeckItem[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.data)
        ? res.data.data
        : [];
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

  // Direct start deck by ID regardless of local deck list loading
  const startDeckById = React.useCallback(async (deckId: string) => {
    setIsLoading(true);
    try {
      const res = await api.get<any>(`/v1/quiz-decks/${deckId}`);
      const data =
        res && Array.isArray(res.cards)
          ? res
          : res?.data && Array.isArray(res.data.cards)
          ? res.data
          : res?.data?.data && Array.isArray(res.data.data.cards)
          ? res.data.data
          : res || {};
      const rawCards = Array.isArray(data?.cards) ? data.cards : [];
      const title = data.title || "Grammar Bamboozle Battle";
      const category = data.category || "Grammar";

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
              ? `Savol #${idx + 1}: Select the correct grammar form?`
              : t.toUpperCase(),
          options: ["Option A", "Option B", "Option C", "Option D"],
          correct_answer: "Option A",
        }));
      }

      setActiveDeck({
        title,
        category,
        cards: gameCards,
      });
    } catch (err) {
      console.error("Direct deck start error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (requestedDeckId) {
      startDeckById(requestedDeckId);
    }
  }, [requestedDeckId, startDeckById]);

  const handleStartGame = (deck: QuizDeckItem) => {
    startDeckById(deck.id);
  };

  const handleStart1v1Challenge = async (deck: QuizDeckItem) => {
    try {
      setIsLoading(true);
      const res = await api.post<any>("/v1/bamboozle/rooms/create", {
        deck_id: deck.id,
        host_name: me?.user?.name || "O'yinchi 1",
      });
      const room = res?.data?.data || res?.data || res;
      if (room && room.room_code) {
        setChallengeModal({
          roomCode: room.room_code,
          deckId: String(deck.id),
          deckTitle: room.deck_title || deck.title,
          shareUrl: room.share_url,
          telegramShareUrl: room.telegram_share_url,
          cards: room.cards || [],
        });
      }
    } catch (e) {
      toast.error("1v1 xonasini yaratishda xatolik yuz berdi");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartGameLegacy = async (deck: QuizDeckItem) => {
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
        roomCode={activeDeck.roomCode}
        shareUrl={activeDeck.shareUrl}
        telegramShareUrl={activeDeck.telegramShareUrl}
        team1Name={activeDeck.team1Name}
        team2Name={activeDeck.team2Name}
        onExit={() => {
          setActiveDeck(null);
          router.replace("/bamboozle");
        }}
      />
    );
  }

  const categories = ["All", "Grammar", "Vocabulary", "IELTS", "General"];

  const filteredDecks = decks.filter((d) => {
    const deckCat = (d.category || "").toLowerCase();
    const isGrammarCat = selectedCategory.toLowerCase() === "grammar";
    const matchesCat =
      selectedCategory === "All" ||
      deckCat === selectedCategory.toLowerCase() ||
      (isGrammarCat && (
        deckCat === "grammar" ||
        d.title.toLowerCase().includes("grammar") ||
        d.title.toLowerCase().includes("noun") ||
        d.title.toLowerCase().includes("adjective") ||
        d.title.toLowerCase().includes("adverb") ||
        d.title.toLowerCase().includes("numeral") ||
        d.title.toLowerCase().includes("article")
      ));
    const matchesSearch =
      !searchQuery || d.title.toLowerCase().includes(searchQuery.toLowerCase());
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
      {/* 1v1 Viral Challenge Invite Modal */}
      {challengeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-[#0B0F17] p-6 text-white shadow-2xl relative space-y-4">
            <button
              type="button"
              onClick={() => setChallengeModal(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Swords className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white">Do&apos;st bilan 1v1 Bellashuv</h3>
                <p className="text-xs text-slate-400">{challengeModal.deckTitle}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4 text-center space-y-1">
              <span className="text-[11px] font-mono text-emerald-400 uppercase tracking-widest">Unikal Xona Kodi</span>
              <div className="text-3xl font-black font-mono text-white tracking-widest">{challengeModal.roomCode}</div>
              <p className="text-[11px] text-slate-400 pt-1">
                Do&apos;stingiz ushbu kod yoki havola orqali bevosita arenaga ulanadi
              </p>
            </div>

            <div className="space-y-2">
              <a
                href={challengeModal.telegramShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 transition-all hover:scale-[1.01]"
              >
                <Send className="w-4 h-4 fill-current" />
                <span>📲 Telegram orqali do&apos;stga yuborish</span>
              </a>

              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 truncate">
                  {challengeModal.shareUrl}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(challengeModal.shareUrl);
                    setIsCopied(true);
                    toast.success("Havoladan nusxa olindi!");
                    setTimeout(() => setIsCopied(false), 2000);
                  }}
                  className="border-slate-700 bg-slate-900 text-xs text-slate-200 hover:bg-slate-800 shrink-0"
                >
                  {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => {
                setActiveDeck({
                  title: challengeModal.deckTitle,
                  category: "Grammar",
                  cards: challengeModal.cards,
                  roomCode: challengeModal.roomCode,
                  shareUrl: challengeModal.shareUrl,
                  telegramShareUrl: challengeModal.telegramShareUrl,
                  team1Name: me?.user?.name || "O'yinchi 1",
                  team2Name: "Do'st (Kutilmoqda)",
                });
                setChallengeModal(null);
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
            >
              <Swords className="w-4 h-4" />
              <span>⚔️ Arenaga Kirish</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}