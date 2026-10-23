import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { diagnosticsService } from "./diagnosticsService";
import { QUEUE_KEY, QUEUE_MAX, SWITCH_KEY, errorReports } from "./errorReports";

const memoryStorage = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key)
  };
};

const kind = (message: string) => ({ name: "TypeError", message, frames: ["openBook@assets/LibraryPage.js"] });
const logged = () => invoke.mock.calls.filter(([command]) => command === "log_client_error");

describe("error reports, on the device", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    invoke.mockReset();
    invoke.mockImplementation(async () => undefined);
    errorReports.resetSession();
  });

  it("count the same kind once, keep twenty kinds at most, and remember them for the next session", () => {
    errorReports.setVersion("1.5.12");
    errorReports.note(kind("a"));
    errorReports.note(kind("a"));
    errorReports.note(kind("b"));
    expect(errorReports.waiting().map(({ message, count, version }) => ({ message, count, version }))).toEqual([
      { message: "a", count: 2, version: "1.5.12" },
      { message: "b", count: 1, version: "1.5.12" }
    ]);
    for (let index = 0; index < 30; index += 1) errorReports.note(kind(`kind ${String.fromCharCode(65 + index)}`));
    expect(errorReports.waiting()).toHaveLength(QUEUE_MAX);
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toHaveLength(QUEUE_MAX);
  });

  it("are on unless switched off, and switching off forgets what was waiting and notes nothing more", () => {
    expect(errorReports.on()).toBe(true);
    errorReports.note(kind("a"));
    errorReports.setOn(false);
    expect(localStorage.getItem(SWITCH_KEY)).toBe("off");
    expect(errorReports.waiting()).toEqual([]);
    errorReports.note(kind("b"));
    expect(errorReports.waiting()).toEqual([]);
    errorReports.setOn(true);
    expect(errorReports.on()).toBe(true);
  });

  it("go in one batch, once a session; what happens after waits for the next", async () => {
    const send = vi.fn(async () => true);
    errorReports.note(kind("a"));
    errorReports.note(kind("b"));
    await errorReports.sendOnce(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[0]).toHaveLength(2);
    expect(errorReports.waiting()).toEqual([]);
    errorReports.note(kind("c"));
    await errorReports.sendOnce(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(errorReports.waiting().map((kept) => kept.message)).toEqual(["c"]);
    errorReports.resetSession();
    await errorReports.sendOnce(send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("send nothing when there is nothing, or when switched off", async () => {
    const send = vi.fn(async () => true);
    await errorReports.sendOnce(send);
    errorReports.note(kind("a"));
    errorReports.setOn(false);
    await errorReports.sendOnce(send);
    expect(send).not.toHaveBeenCalled();
  });

  it("from an older server (no such route) are dropped quietly: no retry, nothing logged", async () => {
    invoke.mockImplementation(async (command: string) => (command === "send_error_kinds" ? false : undefined));
    errorReports.note(kind("a"));
    await diagnosticsService.sendErrorReport();
    await diagnosticsService.sendErrorReport();
    expect(invoke.mock.calls.filter(([command]) => command === "send_error_kinds")).toHaveLength(1);
    expect(errorReports.waiting()).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("that could not be sent (offline) wait for the next session, and nothing is logged", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "send_error_kinds") throw "Could not reach the Leaflet server. Check your connection.";
    });
    errorReports.note(kind("a"));
    await diagnosticsService.sendErrorReport();
    expect(errorReports.waiting().map((kept) => kept.message)).toEqual(["a"]);
    expect(logged()).toEqual([]);
  });

  it("come from what the interface logs, scrubbed, and from the panics noted last time", async () => {
    diagnosticsService.logError("unhandled rejection", new TypeError(`Cannot open "Emma" at /home/bob/Emma.epub`));
    expect(errorReports.waiting()[0]).toMatchObject({ name: "TypeError", message: "unhandled rejection: Cannot open <q> at <path>", count: 1 });
    expect(JSON.stringify(errorReports.waiting())).not.toMatch(/Emma|bob/);
    invoke.mockImplementation(async (command: string) =>
      command === "take_panic_reports" ? [{ message: "called `Option::unwrap()` on a `None` value", place: "sync/cloud.rs:12" }] : undefined
    );
    await diagnosticsService.collectPanics();
    expect(errorReports.waiting().map((kept) => kept.name)).toEqual(["TypeError", "Panic"]);
    expect(errorReports.waiting()[1].frames).toEqual(["panic@sync/cloud.rs"]);
  });
});
