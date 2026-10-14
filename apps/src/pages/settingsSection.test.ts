import { afterEach, describe, expect, it, vi } from "vitest";
import { readSettingsSection, rememberSettingsSection } from "./settingsSection";

const kept = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value)
});

describe("readSettingsSection", () => {
  afterEach(() => kept.clear());

  it("opens on the section last chosen", () => {
    rememberSettingsSection("library");
    expect(readSettingsSection(["general", "reading", "library"])).toBe("library");
  });

  it("sends a tab that is gone to the one that holds what was on it", () => {
    kept.set("leaflet.settings.section", "habit");
    expect(readSettingsSection(["general", "reading", "library"])).toBe("reading");
    kept.set("leaflet.settings.section", "about");
    expect(readSettingsSection(["general", "reading", "library"])).toBe("general");
  });

  it("falls back to the first for a section this build does not offer, or nothing kept", () => {
    rememberSettingsSection("account");
    expect(readSettingsSection(["general", "reading", "library"])).toBe("general");
    kept.clear();
    expect(readSettingsSection(["general", "reading"])).toBe("general");
  });
});
