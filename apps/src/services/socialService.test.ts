import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { socialService } from "./socialService";

const NOON = Date.UTC(2026, 9, 3, 12, 0, 0);

describe("publishing the reader's minutes", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(true);
    socialService.forgetPublish();
    socialService.onCallFailed(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes out at most once a minute, unless forced", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOON);
    expect(await socialService.publishStats()).toBe(true);
    clock.mockReturnValue(NOON + 30_000);
    expect(await socialService.publishStats()).toBe(false);
    expect(await socialService.publishStats({ force: true })).toBe(true);
    clock.mockReturnValue(NOON + 95_000);
    expect(await socialService.publishStats()).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("is not held up by a clock that was set back", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOON);
    expect(await socialService.publishStats()).toBe(true);
    // The clock goes back a day (a corrected time zone, a dead battery, a
    // reader winding it back). The last publish is now "in the future", and
    // nothing was sent again until the clock passed it: a day with no row.
    clock.mockReturnValue(NOON - 86_400_000);
    expect(await socialService.publishStats()).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    // From there the minute is counted on the new clock.
    clock.mockReturnValue(NOON - 86_400_000 + 20_000);
    expect(await socialService.publishStats()).toBe(false);
  });

  it("keeps why it failed, and forgets both that and the minute's wait on sign-out", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOON);
    invoke.mockRejectedValueOnce("Your Leaflet sign-in has ended. Sign in again in Settings.");
    expect(await socialService.publishStats()).toBe(false);
    expect(socialService.publishProblem()).toBe("Your Leaflet sign-in has ended. Sign in again in Settings.");

    // Another reader signs in on this computer within the minute.
    socialService.forgetPublish();
    expect(socialService.publishProblem()).toBeNull();
    expect(await socialService.publishStats()).toBe(true);
    expect(socialService.publishProblem()).toBeNull();
  });

  it("does not hand a publish that outlived a sign-out its error to the next reader", async () => {
    let fail: (cause: unknown) => void = () => undefined;
    invoke.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    const pending = socialService.publishStats({ force: true });
    socialService.forgetPublish();
    fail("Could not reach the Leaflet server. Check your connection.");
    expect(await pending).toBe(false);
    expect(socialService.publishProblem()).toBeNull();
  });
});

describe("calls to the server", () => {
  beforeEach(() => {
    invoke.mockReset();
    socialService.onCallFailed(null);
  });

  it("say so when one fails, so a session that ended is noticed", async () => {
    const failed = vi.fn();
    socialService.onCallFailed(failed);

    invoke.mockResolvedValueOnce({ duels: [] });
    await socialService.duels();
    expect(failed).not.toHaveBeenCalled();

    // Rust has just forgotten the session: the server refused it.
    invoke.mockRejectedValueOnce("Your Leaflet sign-in has ended. Sign in again in Settings.");
    await expect(socialService.duels()).rejects.toThrow("Your Leaflet sign-in has ended");
    expect(failed).toHaveBeenCalledTimes(1);

    // The reader's own profile is a call like any other.
    invoke.mockRejectedValueOnce("Sign in to your Leaflet account first.");
    await expect(socialService.profile()).rejects.toThrow("Sign in to your Leaflet account first.");
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("send an emptied name as empty, which removes it, and leave out what was not given", async () => {
    invoke.mockResolvedValue({});
    await socialService.saveProfile({ handle: "adi", displayName: "", visibility: "public" });
    expect(invoke).toHaveBeenLastCalledWith("save_social_profile", { handle: "adi", displayName: "", visibility: "public" });
    await socialService.saveProfile({ visibility: "private" });
    expect(invoke).toHaveBeenLastCalledWith("save_social_profile", { handle: null, displayName: null, visibility: "private" });
  });
});
