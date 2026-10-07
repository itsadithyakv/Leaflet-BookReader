import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { useAccountStore } from "./accountStore";
import type { AccountStatus } from "../services/accountService";

const signedIn = (email: string, emailConfirmed: boolean): AccountStatus => ({
  available: true,
  apiBase: "https://leaflet.example",
  signedIn: true,
  account: { id: "a1", email, displayName: "Ada", avatar: null, emailConfirmed, createdAt: null },
  offline: false
});
const UNCONFIRMED = signedIn("ada@gmial.com", false);

describe("confirming and changing the account's email", () => {
  beforeEach(() => {
    invoke.mockReset();
    useAccountStore.setState({ status: UNCONFIRMED, loaded: true });
  });

  it("takes the server's answer as the account, so the Settings row goes once confirmed", async () => {
    invoke.mockResolvedValue(signedIn("ada@gmial.com", true));
    await useAccountStore.getState().confirmEmail("ABCD-EFGH");
    expect(invoke).toHaveBeenCalledWith("account_email_confirm", { code: "ABCD-EFGH" });
    expect(useAccountStore.getState().status.account?.emailConfirmed).toBe(true);
  });

  it("asks for a new code with nothing but the session", async () => {
    invoke.mockResolvedValue(UNCONFIRMED);
    await useAccountStore.getState().requestEmailCode();
    expect(invoke).toHaveBeenCalledWith("account_email_code");
    expect(useAccountStore.getState().status).toEqual(UNCONFIRMED);
  });

  it("changes the address with the password, and the new one starts unconfirmed", async () => {
    useAccountStore.setState({ status: signedIn("ada@gmial.com", true) });
    invoke.mockResolvedValue(signedIn("ada@gmail.com", false));
    await useAccountStore.getState().changeEmail("correct horse battery", "ada@gmail.com");
    expect(invoke).toHaveBeenCalledWith("account_change_email", { password: "correct horse battery", email: "ada@gmail.com" });
    expect(useAccountStore.getState().status.account).toMatchObject({ email: "ada@gmail.com", emailConfirmed: false });
  });

  it("leaves the account as it was when the server refuses, and says why", async () => {
    // Rust rejects with the server's own sentence, as a plain string.
    invoke.mockRejectedValue("That code is wrong or has expired. Ask for a new one.");
    await expect(useAccountStore.getState().confirmEmail("AAAA-AAAA")).rejects.toThrow("wrong or has expired");
    invoke.mockRejectedValue("Password is incorrect.");
    await expect(useAccountStore.getState().changeEmail("nope", "ada@gmail.com")).rejects.toThrow("Password is incorrect.");
    expect(useAccountStore.getState().status).toBe(UNCONFIRMED);
  });
});
