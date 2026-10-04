import type { SocialProfile } from "@shared/sync/types";
import type { AccountStatus } from "../../services/accountService";

/**
 * Creating an account, and the profile that goes with it.
 *
 * Two requests, in that order: the account (which signs this device in),
 * then the profile. The server as deployed has no way to do both at once,
 * and done this way an older server and a newer one behave the same.
 *
 * The second can fail when the first has succeeded (the handle is taken; the
 * connection dropped). The account is never undone for it: the reader is
 * signed in with a profile nobody can see, which is exactly what an account
 * was before sharing became the default, and is told what happened so they
 * can pick another handle or leave it private.
 */

export type SignUpInput = {
  email: string;
  password: string;
  /** As typed; empty for none. */
  name: string;
  avatar: string | null;
  /** The bare handle (no "@"); empty for none. */
  handle: string;
  /** "Share my profile" on the form. */
  share: boolean;
};

export type SignUpSteps = {
  /** Creates the account and signs in. Rejects when no account was made. */
  create: (email: string, password: string, name: string, avatar: string | null) => Promise<AccountStatus>;
  /** Saves the profile (see `socialService.saveProfile`). */
  saveProfile: (update: { handle: string; displayName: string; visibility?: "public" }) => Promise<SocialProfile>;
};

export type SignUpOutcome =
  /** All of it done. `profile` is null when there was nothing to save (private, no handle). */
  | { kind: "done"; status: AccountStatus; profile: SocialProfile | null; shared: boolean; note: string | null }
  /** The account exists and is signed in; the profile was not shared, and `reason` says why. */
  | { kind: "created"; status: AccountStatus; reason: string };

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const signUpWithProfile = async (steps: SignUpSteps, input: SignUpInput): Promise<SignUpOutcome> => {
  // If this rejects, nothing was created, and the form shows why.
  const status = await steps.create(input.email, input.password, input.name, input.avatar);
  const name = input.name.trim();

  if (input.share) {
    try {
      const profile = await steps.saveProfile({ handle: input.handle, displayName: name, visibility: "public" });
      return { kind: "done", status, profile, shared: true, note: null };
    } catch (cause) {
      return { kind: "created", status, reason: reasonOf(cause) };
    }
  }

  // Not sharing: an account as it always was. A handle typed anyway is kept
  // for later, on a private profile; failing to keep it loses nothing else.
  if (!input.handle) {
    return { kind: "done", status, profile: null, shared: false, note: null };
  }
  try {
    const profile = await steps.saveProfile({ handle: input.handle, displayName: name });
    return { kind: "done", status, profile, shared: false, note: null };
  } catch (cause) {
    return {
      kind: "done",
      status,
      profile: null,
      shared: false,
      note: `Your handle wasn't saved (${reasonOf(cause)}) Pick one under Social → You.`
    };
  }
};
