"use client";

import * as React from "react";
import { BookPlus, Check, Volume2, X, Sparkles, Loader2, Play } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ClickToVocabWrapperProps {
  children?: React.ReactNode;
  text?: string;
  className?: string;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  onSeekAudio?: (seconds: number) => void;
  sentencesWithTimestamps?: Array<{ text: string; timestamp: number }>;
}

export interface WordLookupData {
  word: string;
  cleanWord: string;
  uzbek: string;
  partOfSpeech: string;
  contextSentence?: string;
  source?: string;
}

export function ClickToVocabWrapper({
  children,
  text,
  className = "",
  onSeekAudio,
  sentencesWithTimestamps,
}: ClickToVocabWrapperProps) {
  const [selectedWord, setSelectedWord] = React.useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [lookupData, setLookupData] = React.useState<WordLookupData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isAddingSrs, setIsAddingSrs] = React.useState(false);
  const [isAddedSrs, setIsAddedSrs] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleWordClick = async (e: React.MouseEvent, rawWord: string) => {
    e.stopPropagation();
    const clean = rawWord.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "");
    if (!clean || clean.length < 2) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };

    setPopoverPosition({
      x: rect.left - containerRect.left,
      y: rect.bottom - containerRect.top + 8,
    });
    setSelectedWord(clean);
    setIsAddedSrs(false);
    setIsLoading(true);

    try {
      const data = await api.get<WordLookupData>(`/v1/vocabulary/lookup?word=${encodeURIComponent(clean)}`);
      setLookupData(data);
    } catch {
      setLookupData({
        word: clean,
        cleanWord: clean,
        uzbek: `'${clean}' so'zi`,
        partOfSpeech: "word",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayPronunciation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedWord || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectedWord);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const handleAddToSRS = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedWord || !lookupData) return;
    setIsAddingSrs(true);
    try {
      await api.post("/v1/vocabulary/user-words/add", {
        english: selectedWord,
        uzbek: lookupData.uzbek,
      });
      setIsAddedSrs(true);
    } catch (err) {
      console.error("SRS add error", err);
    } finally {
      setIsAddingSrs(false);
    }
  };

  const closePopover = () => {
    setSelectedWord(null);
    setPopoverPosition(null);
    setLookupData(null);
  };

  // Render tokens if plain text provided
  const renderInteractiveText = (rawText: string) => {
    const tokens = rawText.split(/(\s+)/);
    return tokens.map((token, i) => {
      const isWord = /[a-zA-Z]{2,}/.test(token);
      if (isWord) {
        return (
          <span
            key={i}
            onClick={(e) => handleWordClick(e, token)}
            className="cursor-pointer hover:bg-emerald-500/20 hover:text-emerald-400 rounded px-0.5 transition-colors underline-offset-4 decoration-emerald-500/30 hover:underline"
            title="Bosib tarjimasini ko'rish va shaxsiy lug'atga qo'shish"
          >
            {token}
          </span>
        );
      }
      return <React.Fragment key={i}>{token}</React.Fragment>;
    });
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Sentences with audio timestamps sync */}
      {sentencesWithTimestamps && sentencesWithTimestamps.length > 0 ? (
        <div className="space-y-3">
          {sentencesWithTimestamps.map((s, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 p-2.5 rounded-xl border border-transparent hover:border-emerald-500/20 hover:bg-emerald-500/5 transition-colors group"
            >
              {onSeekAudio && (
                <button
                  type="button"
                  onClick={() => onSeekAudio(s.timestamp)}
                  className="mt-0.5 shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface text-xs font-medium text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                  title="Ushbu gapdan eshitish"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>{Math.floor(s.timestamp / 60)}:{String(Math.floor(s.timestamp % 60)).padStart(2, "0")}</span>
                </button>
              )}
              <div className="text-foreground leading-relaxed">
                {renderInteractiveText(s.text)}
              </div>
            </div>
          ))}
        </div>
      ) : text ? (
        <div className="leading-relaxed select-text">{renderInteractiveText(text)}</div>
      ) : (
        children
      )}

      {/* Click-to-Vocab Popover Card */}
      {selectedWord && popoverPosition && (
        <div
          style={{
            left: Math.max(10, Math.min(popoverPosition.x, (containerRef.current?.offsetWidth || 300) - 280)),
            top: popoverPosition.y,
          }}
          className="absolute z-50 w-72 rounded-2xl border border-emerald-500/30 bg-[#0B0F17]/95 backdrop-blur-md p-4 shadow-2xl shadow-emerald-950/40 text-foreground animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white capitalize">{selectedWord}</span>
              <button
                type="button"
                onClick={handlePlayPronunciation}
                className="p-1 rounded-lg bg-white/5 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors"
                title="Talaffuzni tinglash"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={closePopover}
              className="p-1 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {isLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              <span>Tarjima qidirilmoqda...</span>
            </div>
          ) : lookupData ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-emerald-400">{lookupData.uzbek}</span>
                {lookupData.partOfSpeech && (
                  <Badge variant="neutral" className="text-[10px] text-muted-foreground border-white/10">
                    {lookupData.partOfSpeech}
                  </Badge>
                )}
              </div>

              {lookupData.contextSentence && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-emerald-500/30 pl-2">
                  "{lookupData.contextSentence}"
                </p>
              )}

              <Button
                type="button"
                size="sm"
                onClick={handleAddToSRS}
                disabled={isAddingSrs || isAddedSrs}
                className={`w-full text-xs font-medium transition-all ${
                  isAddedSrs
                    ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/30"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30"
                }`}
              >
                {isAddingSrs ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Qo'shilmoqda...
                  </>
                ) : isAddedSrs ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Lug'atga qo'shildi! 🎉
                  </>
                ) : (
                  <>
                    <BookPlus className="mr-1.5 h-3.5 w-3.5" />
                    Shaxsiy Lug'atga (SRS) Qo'shish
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
