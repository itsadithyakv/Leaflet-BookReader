import { describe, expect, it, vi } from "vitest";
import { installMiniDom } from "../testing/miniDom";

// The page reads storage and media queries as it loads (`testing/miniDom.ts`).
installMiniDom();

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null), isTauri: () => false }));
// A store with no server snapshot, which a server render cannot read; not what is checked here.
vi.mock("../desktop-pip/DesktopPipSetting", () => ({ DesktopPipSetting: () => null }));

/** What a reader sees: the markup without its tags, and so without any tooltip's words. */
const visible = (markup: string) => markup.replace(/<[^>]*>/g, " ");

describe("Settings, General", () => {
  // The first to load the page and all it imports: a while, on a busy run.
  it("keeps its explanations behind an (i), and offers to report a problem", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SettingsPage } = await import("./SettingsPage");
    const markup = renderToStaticMarkup(<SettingsPage showToast={() => undefined} />);
    const shown = visible(markup);
    for (const words of [
      "For the library and the reader, on this device.",
      "Pip lives out in the app",
      "helps other readers find it"
    ]) {
      expect(markup, words).toContain(words);
      expect(shown, words).not.toContain(words);
    }
    expect(shown).toContain("Copy diagnostics");
    expect(shown).toContain("Report a problem");
  }, 30_000);

  it("keeps what the leaderboards are for behind an (i) too", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { LeaderboardsCard } = await import("../components/LeaderboardsCard");
    const markup = renderToStaticMarkup(<LeaderboardsCard showToast={() => undefined} />);
    const words = "Only your reading stats are sent, never your books.";
    expect(markup).toContain(words);
    expect(visible(markup)).not.toContain(words);
  });

  it("draws the theme cards flat, as the rest of the page is", async () => {
    // Read from disk (a CSS import is emptied under the test runner); named so
    // the app's types need no Node.
    type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
    const css = fs.readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const rules = [...css.matchAll(/\.theme-choice[^{]*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/--shadow-(raised|inset)/);
    }
  });
});
