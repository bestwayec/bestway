import { beforeEach, describe, expect, it } from "vitest";
import { canPlay, readSeat, rememberSeat } from "./BamboozleOnlineArena";

describe("online Bamboozle rules on the client", () => {
  it("lets a player open a card only on their own turn in an active game", () => {
    const card = { is_revealed: false };
    expect(canPlay({ status: "active", active_turn: 1 }, 1, card)).toBe(true);
    expect(canPlay({ status: "active", active_turn: 2 }, 1, card)).toBe(false);
    expect(canPlay({ status: "waiting", active_turn: 1 }, 1, card)).toBe(false);
    expect(canPlay({ status: "finished", active_turn: 1 }, 1, card)).toBe(false);
    expect(canPlay({ status: "active", active_turn: 1 }, 1, { is_revealed: true })).toBe(false);
  });
});

describe("seat storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("remembers the token and team per room", () => {
    rememberSeat("ABC123", "secret", 2);
    expect(readSeat("ABC123")).toEqual({ token: "secret", team: 2 });
    expect(readSeat("OTHER1")).toBeNull();
  });

  it("ignores malformed or blocked storage", () => {
    sessionStorage.setItem("bestway.bamboozle.BAD", "{not json");
    expect(readSeat("BAD")).toBeNull();
    sessionStorage.setItem("bestway.bamboozle.BAD2", JSON.stringify({ token: "x", team: 3 }));
    expect(readSeat("BAD2")).toBeNull();
    globalThis.sessionStorage = { getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readSeat("ABC123")).toBeNull();
    expect(() => rememberSeat("ABC123", "t", 1)).not.toThrow();
  });
});
