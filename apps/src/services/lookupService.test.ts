import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), on: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke, isTauri: () => tauri.on }));

import { LOOKUP_REFUSAL, LookupFailure, lookupService, lookupTerm, webSearchUrl, type LookupResult } from "./lookupService";

const found = (term: string, missed: LookupResult["missed"] = []): LookupResult => ({
  term,
  meaning: null,
  summary: null,
  lead: "meaning",
  missed
});

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (_command: string, args: { term: string }) => found(args.term));
  tauri.on = true;
  lookupService.forget();
});

describe("the term", () => {
  it("is the selection without what it dragged along", () => {
    expect(lookupTerm("  serendipity ")).toBe("serendipity");
    expect(lookupTerm("Marcus\n   Aurelius")).toBe("Marcus Aurelius");
    expect(lookupTerm("“serendipity,”")).toBe("serendipity");
    expect(lookupTerm("(houses).")).toBe("houses");
    expect(lookupTerm("Caesar’s")).toBe("Caesar's");
    expect(lookupTerm("well-known")).toBe("well-known");
    expect(lookupTerm("été")).toBe("été");
  });

  it("is refused when it is nothing, or a passage", () => {
    expect(lookupTerm("")).toBeNull();
    expect(lookupTerm(" \n ")).toBeNull();
    expect(lookupTerm("“…”")).toBeNull();
    expect(lookupTerm("one two three four five six")).toBe("one two three four five six");
    expect(lookupTerm("one two three four five six seven")).toBeNull();
    expect(lookupTerm("a".repeat(80))).toHaveLength(80);
    expect(lookupTerm("a".repeat(81))).toBeNull();
  });

  it("goes into a web search as one value", () => {
    expect(webSearchUrl("ad hoc")).toBe("https://duckduckgo.com/?q=ad%20hoc");
    expect(webSearchUrl("a&b=c#d")).toBe("https://duckduckgo.com/?q=a%26b%3Dc%23d");
  });
});

describe("looking up", () => {
  it("sends the cleaned term and the book's language, and nothing else", async () => {
    await lookupService.lookUp(" “Serendipity,” ", "en-GB");
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("lookup_term", { term: "Serendipity", language: "en-GB" });
  });

  it("asks once for the same term in the same language", async () => {
    const first = await lookupService.lookUp("serendipity", "en");
    const again = await lookupService.lookUp(" serendipity. ", "en-US");
    expect(again).toBe(first);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    // Another language is another question, and so is another spelling.
    await lookupService.lookUp("serendipity", "fr");
    await lookupService.lookUp("Serendipity", "en");
    expect(tauri.invoke).toHaveBeenCalledTimes(3);
  });

  it("asks once even when asked twice at the same moment", async () => {
    const [a, b] = await Promise.all([lookupService.lookUp("word"), lookupService.lookUp("word")]);
    expect(a).toBe(b);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
  });

  it("refuses a passage without asking anyone", async () => {
    await expect(lookupService.lookUp("one two three four five six seven")).rejects.toMatchObject({
      kind: "refused",
      message: LOOKUP_REFUSAL
    });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("reports the backend's reason, and asks again next time", async () => {
    tauri.invoke.mockRejectedValueOnce({ kind: "offline", message: "Couldn't reach Wiktionary or Wikipedia." });
    const failure = await lookupService.lookUp("word").catch((cause) => cause);
    expect(failure).toBeInstanceOf(LookupFailure);
    expect(failure).toMatchObject({ kind: "offline", message: "Couldn't reach Wiktionary or Wikipedia." });
    await expect(lookupService.lookUp("word")).resolves.toMatchObject({ term: "word" });
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
  });

  it("makes something printable of a failure it does not know", async () => {
    tauri.invoke.mockRejectedValueOnce("command lookup_term not found");
    await expect(lookupService.lookUp("word")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("does not keep an answer with a source missing", async () => {
    tauri.invoke.mockResolvedValueOnce(found("word", ["wikipedia"]));
    expect((await lookupService.lookUp("word")).missed).toEqual(["wikipedia"]);
    expect((await lookupService.lookUp("word")).missed).toEqual([]);
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps a bounded number of answers, the latest used", async () => {
    await lookupService.lookUp("first");
    for (let index = 0; index < 59; index += 1) {
      await lookupService.lookUp(`word${index}`);
    }
    expect(tauri.invoke).toHaveBeenCalledTimes(60);
    // Used again, so it is not the oldest when room is needed.
    await lookupService.lookUp("first");
    await lookupService.lookUp("one more");
    await lookupService.lookUp("first");
    expect(tauri.invoke).toHaveBeenCalledTimes(61);
    // "word0" was the oldest and made the room.
    await lookupService.lookUp("word0");
    expect(tauri.invoke).toHaveBeenCalledTimes(62);
  });
});

describe("the browser preview", () => {
  beforeEach(() => {
    tauri.on = false;
    vi.stubGlobal("window", { setTimeout: (run: () => void) => run() });
  });

  it("answers with a sample, labelled as one, and calls nothing", async () => {
    const result = await lookupService.lookUp("serendipity");
    expect(result.sample).toBe(true);
    expect(result.lead).toBe("meaning");
    expect(result.meaning?.entries[0].definitions).toHaveLength(3);
    expect(result.summary?.extract).toContain("nothing was looked up");
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("can show each outcome", async () => {
    expect((await lookupService.lookUp("Marcus Aurelius")).lead).toBe("summary");
    expect(await lookupService.lookUp("nothing")).toMatchObject({ meaning: null, summary: null });
    expect((await lookupService.lookUp("ambiguous")).summary).toMatchObject({ ambiguous: true, extract: "" });
    expect((await lookupService.lookUp("plural")).meaning?.root?.word).toBe("singular");
    await expect(lookupService.lookUp("offline")).rejects.toMatchObject({ kind: "offline" });
  });
});
