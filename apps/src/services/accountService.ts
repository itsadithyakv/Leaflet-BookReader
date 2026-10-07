import { invoke, isTauri } from "@tauri-apps/api/core";

/** A Leaflet account as the server describes it. Never includes a token. */
export type Account = {
  id: string;
  email: string;
  displayName: string | null;
  /** The avatar picked at signup or since (`skin.move`, see `pip/avatars.ts`), or null. */
  avatar: string | null;
  /**
   * Whether the address was confirmed with an emailed code. Missing or null
   * when the server did not say (one from before confirmation existed): the
   * app then shows nothing about it.
   */
  emailConfirmed?: boolean | null;
  createdAt: string | null;
};

export type AccountStatus = {
  /** A Leaflet server is configured, so accounts can be used at all. */
  available: boolean;
  apiBase: string | null;
  signedIn: boolean;
  account: Account | null;
  /** Signed in, but the server could not be reached to confirm it. */
  offline: boolean;
};

export const SIGNED_OUT: AccountStatus = {
  available: false,
  apiBase: null,
  signedIn: false,
  account: null,
  offline: false
};

/** Tauri rejects with the Rust error string; normalise to something printable. */
export const errorMessage = (cause: unknown, fallback = "Something went wrong.") =>
  typeof cause === "string" ? cause : cause instanceof Error ? cause.message : fallback;

/**
 * Optional email + password accounts.
 *
 * The session token never reaches the webview: Rust keeps it in the OS
 * keychain and attaches it to requests itself. These calls only ever see who
 * is signed in.
 */
export const accountService = {
  async status(refresh = false): Promise<AccountStatus> {
    if (!isTauri()) {
      return SIGNED_OUT;
    }
    return invoke<AccountStatus>("account_status", { refresh });
  },

  async signUp(email: string, password: string, displayName?: string, avatar?: string | null): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_signup", {
      email,
      password,
      displayName: displayName?.trim() || null,
      avatar: avatar ?? null
    });
  },

  /** Picks a new avatar, or clears it with null. */
  async setAvatar(avatar: string | null): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_set_avatar", { avatar });
  },

  /** Emails a new confirmation code to the account's address. */
  async requestEmailCode(): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_email_code");
  },

  /** Confirms the account's address with the emailed code. */
  async confirmEmail(code: string): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_email_confirm", { code });
  },

  /** A new address, with the password. It starts unconfirmed and is sent a code. */
  async changeEmail(password: string, email: string): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_change_email", { password, email });
  },

  async signIn(email: string, password: string): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_login", { email, password });
  },

  /** Emails a reset code, if the address has an account. Minutes the code lasts. */
  async requestReset(email: string): Promise<number> {
    return invoke<number>("account_reset_request", { email });
  },

  /** A new password with the emailed code; signs this device in. */
  async confirmReset(email: string, code: string, password: string): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_reset_confirm", { email, code, password });
  },

  async signOut(): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_logout");
  },

  /** Signs out every other device as well. */
  async changePassword(current: string, next: string): Promise<void> {
    await invoke("account_change_password", { current, next });
  },

  /** Deletes the account and everything the server holds for it. */
  async deleteAccount(password: string): Promise<AccountStatus> {
    return invoke<AccountStatus>("account_delete", { password });
  },

  /** Opens a public https page (privacy policy, terms) in the browser. */
  async openLink(url: string): Promise<void> {
    if (!isTauri()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    await invoke("open_public_link", { url });
  }
};
