import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const sent: Array<{ command: string; args: unknown }> = [];
let answers: Record<string, unknown> = {};
let onPhone = true;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => onPhone,
  invoke: async (command: string, args?: unknown) => {
    sent.push({ command, args });
    calls.push(command);
    const answer = answers[command];
    if (answer instanceof Error) throw answer;
    return answer ?? null;
  }
}));
let noun: "phone" | "tablet" = "phone";
let release = 15;
vi.mock("./device", () => ({ isAndroid: () => onPhone, deviceNoun: () => noun, androidVersion: () => release }));

const { android, followAppTheme, holdBarLook, holdNightMode, nightModeHeld } =
  await import("./android");

describe("android.requestReview", () => {
  beforeEach(() => {
    calls.length = 0;
    answers = {};
    onPhone = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("stops at Google Play's sheet when it was shown", async () => {
    answers["plugin:leaflet-device|request_review"] = { launched: true, shown: true };
    await android.requestReview();
    expect(calls).toEqual(["plugin:leaflet-device|request_review"]);
  });

  it("opens the Play page when Google showed nothing (its quota), asking once", async () => {
    answers["plugin:leaflet-device|request_review"] = { launched: true, shown: false };
    await android.requestReview();
    expect(calls).toEqual(["plugin:leaflet-device|request_review", "plugin:leaflet-device|open_store"]);
  });

  it("opens the Play page when the flow fails or Play is missing", async () => {
    answers["plugin:leaflet-device|request_review"] = { launched: false, shown: false };
    await android.requestReview();
    answers["plugin:leaflet-device|request_review"] = new Error("no Play Store");
    await android.requestReview();
    expect(calls.filter((command) => command.endsWith("open_store"))).toHaveLength(2);
  });

  it("does nothing off Android", async () => {
    onPhone = false;
    await android.requestReview();
    expect(calls).toEqual([]);
  });
});

describe("the bars' look", () => {
  const argsOf = (command: string) =>
    sent.filter((entry) => entry.command.endsWith(command)).map((entry) => entry.args);
  const looks = () => argsOf("set_bar_look").map((args) => (args as { light: boolean }).light);
  const nightModes = () => argsOf("set_night_mode").map((args) => (args as { mode: string }).mode);

  beforeEach(() => {
    sent.length = 0;
    onPhone = true;
  });

  it("follows the app's theme, not the phone's: light icons on a dark app", async () => {
    followAppTheme("dark", false);
    followAppTheme("light", false);
    await Promise.resolve();
    expect(looks()).toEqual([false, true]);
    expect(nightModes()).toEqual(["dark", "light"]);
  });

  it("leaves the night mode to the phone when the app follows it", async () => {
    followAppTheme("dark", true);
    await Promise.resolve();
    expect(nightModes()).toEqual(["system"]);
  });

  it("is held by an open book over the app's theme, and given back when it closes", async () => {
    followAppTheme("dark", false);
    const release = holdBarLook(true);
    // The theme changing under the book does not take the bars from it.
    followAppTheme("dark", false);
    release();
    await Promise.resolve();
    expect(looks()).toEqual([false, true, true, false]);
  });

  it("has its night mode held by an open book's page, the newest hold first", async () => {
    followAppTheme("light", false);
    // A True black page on a light app: Android draws a `<select>`'s list dark.
    const release = holdNightMode("dark");
    expect(nightModeHeld()).toBe(true);
    // The theme changing under the book does not take the night mode from it.
    followAppTheme("light", false);
    // A newer hold (the page turned light) wins until it is let go.
    const releaseLight = holdNightMode("light");
    releaseLight();
    release();
    expect(nightModeHeld()).toBe(false);
    await Promise.resolve();
    expect(nightModes()).toEqual(["light", "dark", "dark", "light", "dark", "light"]);
  });

  it("gives the night mode back to the phone when the app follows it", async () => {
    followAppTheme("light", true);
    holdNightMode("dark")();
    await Promise.resolve();
    expect(nightModes()).toEqual(["system", "dark", "system"]);
  });
});

const expectTurn = vi.hoisted(() => vi.fn());
vi.mock("./shape", () => ({ expectTurn }));

describe("a rotation hold", () => {
  beforeEach(() => {
    sent.length = 0;
    expectTurn.mockClear();
    onPhone = true;
  });

  it("tells the shell the screen is about to turn, as it is taken and let go (Pip's tab, then the library)", async () => {
    const { holdRotation } = await import("./android");
    const release = holdRotation("landscape");
    expect(expectTurn).toHaveBeenLastCalledWith("landscape");
    // The arcade over Pip's tab holds it the same way: no turn.
    const arcade = holdRotation("landscape");
    arcade();
    expect(expectTurn).toHaveBeenCalledTimes(1);
    release();
    // Let go: the phone's to say which way up, and a phone is most likely upright again (the library).
    expect(expectTurn).toHaveBeenLastCalledWith("portrait", { guess: true });
    expect(expectTurn).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(sent.filter((entry) => entry.command.endsWith("lock_rotation")).map((entry) => (entry.args as { lock: string }).lock)).toEqual([
      "landscape",
      "landscape",
      "landscape",
      "auto"
    ]);
  });

  it("lets a tablet say which way up when a hold is let go", async () => {
    noun = "tablet";
    try {
      const { holdRotation } = await import("./android");
      holdRotation("landscape")();
      expect(expectTurn).toHaveBeenLastCalledWith(null);
    } finally {
      noun = "phone";
    }
  });

  it("expects no turn on a tablet from Android 16, which lays the app out however it is held", async () => {
    noun = "tablet";
    release = 16;
    try {
      const { holdRotation } = await import("./android");
      holdRotation("landscape")();
      expect(expectTurn).not.toHaveBeenCalled();
      // A phone on Android 16 still turns as it is held.
      noun = "phone";
      holdRotation("landscape")();
      expect(expectTurn).toHaveBeenCalledWith("landscape");
    } finally {
      noun = "phone";
      release = 15;
    }
  });

  it("says nothing of a turn off Android", async () => {
    onPhone = false;
    const { holdRotation } = await import("./android");
    holdRotation("portrait")();
    expect(expectTurn).not.toHaveBeenCalled();
  });
});
