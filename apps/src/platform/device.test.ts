import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceNoun } from "./device";

const on = (userAgent: string, width: number, height: number) => {
  vi.stubGlobal("navigator", { userAgent });
  vi.stubGlobal("screen", { width, height });
};

describe("deviceNoun", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls an Android screen under 600 dp on its short side a phone, and one at 600 or more a tablet", () => {
    on("Mozilla/5.0 (Linux; Android 16; Pixel 7)", 412, 915);
    expect(deviceNoun()).toBe("phone");
    on("Mozilla/5.0 (Linux; Android 16; Pixel 7)", 915, 412);
    expect(deviceNoun()).toBe("phone");
    on("Mozilla/5.0 (Linux; Android 16; Pixel Tablet)", 1280, 800);
    expect(deviceNoun()).toBe("tablet");
    on("Mozilla/5.0 (Linux; Android 16; Pixel Fold)", 673, 841);
    expect(deviceNoun()).toBe("tablet");
  });

  it("calls anything else a computer", () => {
    on("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 1920, 1080);
    expect(deviceNoun()).toBe("computer");
  });
});
