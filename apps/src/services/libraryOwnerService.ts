import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LibraryResolveResult } from "@shared/sync/types";

/**
 * Whose this device's library is (docs/two-devices.md, "One library, one
 * owner; the account carries the state").
 *
 * A library belongs to the first Leaflet account that syncs it. Signed in as
 * another account, Leaflet keeps that account's reading apart: in a library of
 * its own on this device, or out of reading sync altogether. Opening another
 * library swaps the database under the app, which then reloads
 * (store/libraryOwnerStore.ts).
 */
export const libraryOwnerService = {
  /**
   * What to do now someone is signed in: nothing (`stay`), nothing more since
   * the library was just adopted (`claimed`), open the account's own library
   * (`switch`), or ask (`offer`).
   */
  async resolve(): Promise<LibraryResolveResult> {
    if (!isTauri()) {
      return { action: "stay" };
    }
    return invoke<LibraryResolveResult>("library_resolve");
  },

  /** Makes the signed-in account's own library on this device the one in use. The app reloads after. */
  async openMine(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("library_open_mine");
  },

  /** A new, empty library for the signed-in account (or its own, if it has one). The app reloads after. */
  async startFresh(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("library_start_fresh");
  },

  /** Keeps this library out of reading sync while another account is signed in (Social goes on working). */
  async stayOut(on: boolean): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("library_stay_out", { on });
  },

  /**
   * The answer to "your account already has a library": bring it into this
   * fresh one (`true`), or replace what the account holds with this empty
   * library (`false`). Either way a sync follows, in the backend.
   */
  async freshAnswer(useIt: boolean): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("library_fresh_answer", { useIt });
  }
};
