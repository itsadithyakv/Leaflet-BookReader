import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Announcement } from "./adminService";
import { buttonOf, driveUsed, forDevice, forThisDevice, markSeen, noteDriveUsed, seenIds, type Device } from "./announcements";

const memoryStorage = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key)
  };
};

const item = (id: string, audience: Announcement["audience"] = { kind: "everyone" }, extra: Partial<Announcement> = {}): Announcement => ({
  id,
  title: "Sorry",
  body: "Drive needs you.",
  link: null,
  audience,
  at: "2026-10-23T10:00:00.000Z",
  expiresAt: null,
  ...extra
});

const phone: Device = { platform: "android", version: "1.5.11", driveUsed: false };
const computer: Device = { platform: "windows", version: "1.5.12", driveUsed: true };

describe("announcements, on the device", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));

  it("are for the readers their audience names, decided here", () => {
    expect(forDevice({ kind: "everyone" }, phone)).toBe(true);
    expect(forDevice({ kind: "android" }, phone)).toBe(true);
    expect(forDevice({ kind: "android" }, computer)).toBe(false);
    expect(forDevice({ kind: "windows" }, computer)).toBe(true);
    expect(forDevice({ kind: "below", version: "1.5.12" }, phone)).toBe(true);
    expect(forDevice({ kind: "below", version: "1.5.12" }, computer)).toBe(false);
    expect(forDevice({ kind: "below", version: "1.5.12" }, { ...phone, version: null })).toBe(false);
    expect(forDevice({ kind: "drive" }, computer)).toBe(true);
    expect(forDevice({ kind: "drive" }, phone)).toBe(false);
    // An audience from a newer server reaches nobody rather than everybody.
    expect(forDevice({ kind: "ios" } as unknown as Announcement["audience"], phone)).toBe(false);
  });

  it("are shown once: put away, never again on this device", () => {
    const list = [item("aaaaaaaaaaaa"), item("bbbbbbbbbbbb", { kind: "windows" }), item("cccccccccccc")];
    expect(forThisDevice(list, phone).map((entry) => entry.id)).toEqual(["aaaaaaaaaaaa", "cccccccccccc"]);
    markSeen("aaaaaaaaaaaa");
    markSeen("aaaaaaaaaaaa");
    expect([...seenIds()]).toEqual(["aaaaaaaaaaaa"]);
    expect(forThisDevice(list, phone).map((entry) => entry.id)).toEqual(["cccccccccccc"]);
    expect(forThisDevice(undefined, phone)).toEqual([]);
  });

  it("are not shown once run out, even before the server has dropped them", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const list = [item("aaaaaaaaaaaa", undefined, { expiresAt: "2026-10-23T11:00:00.000Z" }), item("bbbbbbbbbbbb", undefined, { expiresAt: "2026-10-24T11:00:00.000Z" })];
    expect(forThisDevice(list, phone, new Set(), now).map((entry) => entry.id)).toEqual(["bbbbbbbbbbbb"]);
  });

  it("remember that Drive was used here, even once it is disconnected", () => {
    expect(driveUsed()).toBe(false);
    noteDriveUsed();
    expect(driveUsed()).toBe(true);
  });

  it("offer a button only for an https link or an action this app knows", () => {
    expect(buttonOf({ label: "Reconnect", action: "reconnect_drive" })).toEqual({ label: "Reconnect", action: "reconnect_drive" });
    expect(buttonOf({ label: "Settings", action: "open_library_settings" })).toEqual({ label: "Settings", action: "open_library_settings" });
    expect(buttonOf({ label: "Tell us", action: "report_problem" })).toEqual({ label: "Tell us", action: "report_problem" });
    expect(buttonOf({ label: "Read", url: "https://example.com/news" })).toEqual({ label: "Read", url: "https://example.com/news" });
    // A newer server's action, a link that is not https, no label: no button (the announcement still shows).
    expect(buttonOf({ label: "Go", action: "open_hollow" })).toBeNull();
    expect(buttonOf({ label: "Go", url: "http://example.com" })).toBeNull();
    expect(buttonOf({ label: "Go", url: "javascript:alert(1)" })).toBeNull();
    expect(buttonOf({ label: "", url: "https://example.com" })).toBeNull();
    expect(buttonOf(null)).toBeNull();
  });
});
