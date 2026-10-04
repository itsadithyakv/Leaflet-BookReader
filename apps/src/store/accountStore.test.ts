import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { useAccountStore } from "./accountStore";
import { socialService } from "../services/socialService";
import type { AccountStatus } from "../services/accountService";

const API = "https://leaflet.example";
const SIGNED_IN: AccountStatus = {
  available: true,
  apiBase: API,
  signedIn: true,
  account: { id: "a1", email: "adi@example.com", displayName: "Adi", avatar: null, createdAt: null },
  offline: true
};
const ENDED = "Your Leaflet sign-in has ended. Sign in again in Settings.";

describe("a session that ends while the app is open", () => {
  beforeEach(() => {
    invoke.mockReset();
    useAccountStore.setState({ status: SIGNED_IN, loaded: true });
  });

  it("is noticed from the first call the server refuses", async () => {
    // The password was changed on another computer. Rust forgets the session
    // as the call fails, and says so the next time it is asked.
    invoke.mockImplementation(async (command: string) => {
      if (command === "account_status") {
        return { available: true, apiBase: API, signedIn: false, account: null, offline: false };
      }
      throw ENDED;
    });
    await expect(socialService.duels()).rejects.toThrow(ENDED);
    await vi.waitFor(() => expect(useAccountStore.getState().status.signedIn).toBe(false));
    // Asked of this device only: no request to the server.
    expect(invoke).toHaveBeenCalledWith("account_status", { refresh: false });
  });

  it("is not assumed when a call fails for any other reason", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "account_status") {
        return { ...SIGNED_IN, offline: false };
      }
      throw "Could not reach the Leaflet server. Check your connection.";
    });
    await expect(socialService.duels()).rejects.toThrow("Could not reach");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("account_status", { refresh: false }));
    await Promise.resolve();
    // Still signed in, and what was known (the server being out of reach) is kept.
    expect(useAccountStore.getState().status).toBe(SIGNED_IN);
  });

  it("is not looked for when nobody is signed in", async () => {
    useAccountStore.setState({ status: { ...SIGNED_IN, signedIn: false, account: null } });
    invoke.mockRejectedValue("No shared profile with that handle.");
    await expect(socialService.reader("nobody")).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
