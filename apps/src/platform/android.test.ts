import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let answers: Record<string, unknown> = {};
let onPhone = true;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => onPhone,
  invoke: async (command: string) => {
    calls.push(command);
    const answer = answers[command];
    if (answer instanceof Error) throw answer;
    return answer ?? null;
  }
}));
vi.mock("./device", () => ({ isAndroid: () => onPhone }));

const { android } = await import("./android");

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
