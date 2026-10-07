import { describe, expect, it, vi } from "vitest";
import type { SocialProfile } from "@shared/sync/types";
import type { AccountStatus } from "../../services/accountService";
import { asksForEmailCode, emailCodeReady, signUpWithProfile, type SignUpInput } from "./signUpFlow";

const STATUS: AccountStatus = {
  available: true,
  apiBase: "https://leaflet.example",
  signedIn: true,
  account: { id: "a1", email: "ada@example.com", displayName: "Ada", avatar: "wizard.magic", createdAt: null },
  offline: false
};

const profileOf = (visibility: "public" | "private"): SocialProfile => ({
  handle: "ada",
  displayName: "Ada",
  visibility,
  weekMinutes: 0,
  streak: 0,
  booksFinished: 0,
  shelf: []
});

const input = (over: Partial<SignUpInput> = {}): SignUpInput => ({
  email: "ada@example.com",
  password: "correct horse battery",
  name: " Ada ",
  avatar: "wizard.magic",
  handle: "ada",
  share: true,
  ...over
});

describe("signing up", () => {
  it("creates the account, then shares the profile under the handle", async () => {
    const create = vi.fn().mockResolvedValue(STATUS);
    const saveProfile = vi.fn().mockResolvedValue(profileOf("public"));
    const outcome = await signUpWithProfile({ create, saveProfile }, input());

    expect(create).toHaveBeenCalledWith("ada@example.com", "correct horse battery", " Ada ", "wizard.magic");
    // One save, public, with the handle and the name: on the board without another step.
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(saveProfile).toHaveBeenCalledWith({ handle: "ada", displayName: "Ada", visibility: "public" });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(saveProfile.mock.invocationCallOrder[0]);
    expect(outcome).toEqual({ kind: "done", status: STATUS, profile: profileOf("public"), shared: true, note: null });
  });

  it("creates nothing, and saves nothing, when the account is refused", async () => {
    const create = vi.fn().mockRejectedValue(new Error("An account with that email already exists. Sign in instead."));
    const saveProfile = vi.fn();
    await expect(signUpWithProfile({ create, saveProfile }, input())).rejects.toThrow("already exists");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("keeps the account when the handle turns out to be taken", async () => {
    const create = vi.fn().mockResolvedValue(STATUS);
    const saveProfile = vi.fn().mockRejectedValue(new Error("That handle is taken."));
    const outcome = await signUpWithProfile({ create, saveProfile }, input());
    // Signed in, not shared, and the reason is there to show beside the field.
    expect(outcome).toEqual({ kind: "created", status: STATUS, reason: "That handle is taken." });
  });

  it("keeps the account when the connection drops between the two", async () => {
    const create = vi.fn().mockResolvedValue(STATUS);
    // Rust rejects with plain strings.
    const saveProfile = vi.fn().mockRejectedValue("Could not reach the Leaflet server. Check your connection.");
    const outcome = await signUpWithProfile({ create, saveProfile }, input());
    expect(outcome).toMatchObject({ kind: "created", status: STATUS, reason: expect.stringContaining("Could not reach") });
  });

  it("with sharing switched off, makes the account and no profile at all", async () => {
    const create = vi.fn().mockResolvedValue(STATUS);
    const saveProfile = vi.fn();
    const outcome = await signUpWithProfile({ create, saveProfile }, input({ share: false, handle: "" }));
    expect(saveProfile).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "done", status: STATUS, profile: null, shared: false, note: null });
  });

  it("with sharing switched off, keeps a handle that was typed anyway, privately", async () => {
    const create = vi.fn().mockResolvedValue(STATUS);
    const saveProfile = vi.fn().mockResolvedValue(profileOf("private"));
    const outcome = await signUpWithProfile({ create, saveProfile }, input({ share: false }));
    // No visibility is sent, so the server keeps its own default: private.
    expect(saveProfile).toHaveBeenCalledWith({ handle: "ada", displayName: "Ada" });
    expect(outcome).toMatchObject({ kind: "done", shared: false, note: null });

    saveProfile.mockRejectedValueOnce(new Error("That handle is taken."));
    const taken = await signUpWithProfile({ create, saveProfile }, input({ share: false }));
    expect(taken).toMatchObject({ kind: "done", shared: false, profile: null });
    expect(taken.kind === "done" && taken.note).toContain("That handle is taken.");
  });
});

describe("the emailed code after signing up", () => {
  const said = (emailConfirmed?: boolean | null): AccountStatus => ({
    ...STATUS,
    account: { ...STATUS.account!, ...(emailConfirmed === undefined ? {} : { emailConfirmed }) }
  });

  it("is asked for when the server says the address is not confirmed", async () => {
    const create = vi.fn().mockResolvedValue(said(false));
    const saveProfile = vi.fn().mockResolvedValue(profileOf("public"));
    const outcome = await signUpWithProfile({ create, saveProfile }, input());
    expect(asksForEmailCode(outcome.status)).toBe(true);
  });

  it("is still asked for when the profile was left for another step", async () => {
    const create = vi.fn().mockResolvedValue(said(false));
    const saveProfile = vi.fn().mockRejectedValue(new Error("That handle is taken."));
    const outcome = await signUpWithProfile({ create, saveProfile }, input());
    expect(outcome.kind).toBe("created");
    expect(asksForEmailCode(outcome.status)).toBe(true);
  });

  it("is not asked for by a server that says nothing about confirmation", async () => {
    // An older server: the account comes back without the field at all.
    const create = vi.fn().mockResolvedValue(said());
    const saveProfile = vi.fn().mockResolvedValue(profileOf("public"));
    const outcome = await signUpWithProfile({ create, saveProfile }, input());
    expect(asksForEmailCode(outcome.status)).toBe(false);
    // Rust sends an unknown answer on as null.
    expect(asksForEmailCode(said(null))).toBe(false);
  });

  it("is not asked for once confirmed, or of nobody", () => {
    expect(asksForEmailCode(said(true))).toBe(false);
    expect(asksForEmailCode({ ...STATUS, signedIn: false, account: null })).toBe(false);
  });

  it("is ready at eight letters and digits, however typed", () => {
    expect(emailCodeReady("ABCD-EFGH")).toBe(true);
    expect(emailCodeReady(" abcd efgh ")).toBe(true);
    expect(emailCodeReady("ABCD2345")).toBe(true);
    expect(emailCodeReady("ABCD-EFG")).toBe(false);
    expect(emailCodeReady("ABCD-EFGH-J")).toBe(false);
    expect(emailCodeReady("")).toBe(false);
  });
});
