"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Copy, LogOut, Trophy } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Public room state from the server: unopened cards carry no answer. */
export interface OnlineCard {
  id: string;
  order_index: number;
  card_type: "question" | "swap" | "steal" | "double" | "bomb";
  points: number;
  question_text: string;
  options?: string[];
  correct_answer?: string;
  is_revealed?: boolean;
  revealed_by_team?: 1 | 2 | null;
  effect_message?: string | null;
}

export interface OnlineRoom {
  room_code: string;
  deck_title: string;
  status: "waiting" | "active" | "finished";
  active_turn: 1 | 2;
  team1_score: number;
  team2_score: number;
  team1_name: string;
  team2_name: string;
  cards: OnlineCard[];
  share_url?: string;
  telegram_share_url?: string;
  double_pending?: Record<string, boolean>;
  last_play?: { team: 1 | 2; cardId: string; cardType: string; answer: string | null; isCorrect: boolean | null; message: string } | null;
  version?: number;
  my_team?: 1 | 2;
  player_token?: string;
}

const POLL_MS = 2000;
const KEY = (code: string) => `bestway.bamboozle.${code}`;

/** The seat this browser holds in a room: kept for this tab session only (a game, not a record). */
export function rememberSeat(code: string, token: string, team: 1 | 2) {
  try {
    sessionStorage.setItem(KEY(code), JSON.stringify({ token, team }));
  } catch {
    /* private mode: the seat lasts until reload */
  }
}

export function readSeat(code: string): { token: string; team: 1 | 2 } | null {
  try {
    const raw = sessionStorage.getItem(KEY(code));
    const seat = raw ? (JSON.parse(raw) as { token?: unknown; team?: unknown }) : null;
    return seat && typeof seat.token === "string" && (seat.team === 1 || seat.team === 2) ? { token: seat.token, team: seat.team } : null;
  } catch {
    return null;
  }
}

/** Whether `card` can be opened by `team` right now. */
export function canPlay(room: Pick<OnlineRoom, "status" | "active_turn">, team: 1 | 2, card: Pick<OnlineCard, "is_revealed">) {
  return room.status === "active" && room.active_turn === team && !card.is_revealed;
}

/**
 * 1v1 Bamboozle over HTTP. The server owns the score: it checks the player token and the
 * turn, judges the chosen option and keeps the 2x bonus. Each device polls the room, so it
 * works on the production server (which serves no WebSocket).
 */
export function BamboozleOnlineArena({
  initialRoom,
  token,
  team,
  onExit,
}: {
  initialRoom: OnlineRoom;
  token: string;
  team: 1 | 2;
  onExit: () => void;
}) {
  const t = useTranslations("bamboozleOnline");
  const [room, setRoom] = React.useState<OnlineRoom>(initialRoom);
  const [question, setQuestion] = React.useState<OnlineCard | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const code = initialRoom.room_code;

  const accept = React.useCallback((next: OnlineRoom) => {
    setRoom((prev) => ((next.version ?? 0) >= (prev.version ?? 0) ? next : prev));
  }, []);

  React.useEffect(() => {
    if (room.status === "finished") return;
    let stopped = false;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      api.get<OnlineRoom>(`/v1/bamboozle/rooms/${encodeURIComponent(code)}`)
        .then((next) => !stopped && accept(next))
        .catch(() => undefined); // a missed poll is retried on the next tick
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [code, accept, room.status]);

  async function play(card: OnlineCard, answer?: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const next = await api.post<OnlineRoom>(`/v1/bamboozle/rooms/${encodeURIComponent(code)}/play`, {
        card_id: card.id, answer, player_token: token,
      });
      accept(next);
      setQuestion(null);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  function open(card: OnlineCard) {
    if (!canPlay(room, team, card) || busy) return;
    if (card.card_type === "question") setQuestion(card);
    else void play(card);
  }

  const mine = room.active_turn === team;
  const names = { 1: room.team1_name, 2: room.team2_name } as const;
  const last = room.last_play;
  const winner = room.team1_score === room.team2_score ? 0 : room.team1_score > room.team2_score ? 1 : 2;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" data-testid="bamboozle-online">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">{room.deck_title}</h1>
          <p className="text-sm text-fg-muted">
            {t("room")} <span className="font-mono font-semibold">{code}</span> · {t("youAre", { name: names[team] })}
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onExit}><LogOut className="size-4" aria-hidden /> {t("exit")}</Button>
      </header>

      <div className="grid grid-cols-2 gap-3" role="group" aria-label={t("score")}>
        {([1, 2] as const).map((n) => (
          <div key={n} className={cn("rounded-xl border p-3", room.active_turn === n && room.status === "active" ? "border-brand bg-brand-subtle" : "border-border bg-surface")}
            data-testid={`team-${n}`}>
            <div className="text-xs text-fg-muted">{names[n]}{n === team ? ` (${t("you")})` : ""}</div>
            <div className="text-2xl font-black tabular-nums" data-testid={`team-${n}-score`}>{n === 1 ? room.team1_score : room.team2_score}</div>
            {room.double_pending?.[String(n)] && <div className="text-xs font-semibold text-brand">{t("double")}</div>}
          </div>
        ))}
      </div>

      <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="turn-status">
        {room.status === "waiting" ? t("waiting") : room.status === "finished" ? t("finished") : mine ? t("yourTurn") : t("theirTurn", { name: names[room.active_turn] })}
      </p>
      {last && (
        <p className="rounded-control bg-bg-subtle p-2 text-sm" data-testid="last-play">
          {names[last.team]}: {last.cardType === "question" ? (last.isCorrect ? t("correct") : t("wrong")) : last.message}
        </p>
      )}
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}

      {room.status === "waiting" && room.share_url && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm">
          <span className="truncate">{room.share_url}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => {
            void navigator.clipboard?.writeText(room.share_url ?? "").then(() => setCopied(true)).catch(() => undefined);
          }}><Copy className="size-4" aria-hidden /> {copied ? t("copied") : t("copy")}</Button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 sm:gap-3" data-testid="online-board">
        {room.cards.map((card) => {
          const playable = canPlay(room, team, card) && !busy;
          return (
            <button key={card.id} type="button" disabled={!playable} onClick={() => open(card)}
              data-testid="online-card" data-revealed={card.is_revealed ? "true" : "false"}
              aria-label={card.is_revealed ? `${card.order_index}: ${card.effect_message ?? ""}` : t("card", { n: card.order_index })}
              className={cn("aspect-square rounded-xl border text-lg font-black transition-colors",
                card.is_revealed ? "border-border bg-bg-subtle text-fg-muted text-xs font-medium p-1"
                  : playable ? "border-brand bg-surface hover:bg-brand-subtle" : "border-border bg-surface opacity-70")}>
              {card.is_revealed ? (card.card_type === "question" ? card.correct_answer ?? "✓" : card.card_type.toUpperCase()) : card.order_index}
            </button>
          );
        })}
      </div>

      {question && (
        <div role="dialog" aria-modal="true" aria-labelledby="online-question" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-2xl bg-surface p-5 shadow-xl">
            <h2 id="online-question" className="text-lg font-bold">{question.question_text}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(question.options ?? []).map((option) => (
                <Button key={option} type="button" variant="outline" disabled={busy} onClick={() => void play(question, option)}
                  data-testid="online-option" className="h-auto justify-start whitespace-normal py-3 text-left">
                  {option}
                </Button>
              ))}
            </div>
            <Button type="button" variant="ghost" onClick={() => setQuestion(null)} disabled={busy}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {room.status === "finished" && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-6 text-center" data-testid="online-result">
          <Trophy className="size-10 text-brand" aria-hidden />
          <p className="text-lg font-bold">{winner === 0 ? t("draw") : t("winner", { name: names[winner] })}</p>
        </div>
      )}
    </div>
  );
}
