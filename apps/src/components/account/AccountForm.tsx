import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SocialProfile } from "@shared/sync/types";
import { useAccountStore } from "../../store/accountStore";
import { accountService, errorMessage, type AccountStatus } from "../../services/accountService";
import { socialService } from "../../services/socialService";
import { FEATURES } from "../../constants/features";
import { PRIVACY_URL, TERMS_URL } from "../../constants/links";
import { randomAvatar } from "../../pip/avatars";
import { AvatarPicker } from "../AvatarPicker";
import { useCommunityStore } from "../community/communityStore";
import { COPY } from "../community/copy";
import { at } from "../community/format";
import { handleProblem, suggestHandle } from "../community/handle";
import { HandleField } from "../community/HandleField";
import { signUpWithProfile } from "./signUpFlow";

export type AccountFormMode = "signin" | "signup" | "reset";

type Props = {
  initialMode?: AccountFormMode;
  /** After a sign-in, sign-up or reset: a line for a toast. */
  onDone: (message: string) => void;
  /** Under the heading when signing in or up; the default says it is optional. */
  intro?: ReactNode;
  /** Say "Create your account" rather than "Create an account" (first run). */
  welcoming?: boolean;
};

const fieldClass = "inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface";
const labelClass = "mt-3 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant";

/**
 * Signing in, creating an account, and a forgotten password, in one form.
 * Used by Settings → Account, the first-run account step and the profile menu,
 * so the three can never drift apart.
 *
 * A new account's profile is shared with other readers unless the switch on
 * the form is turned off: the form asks for a handle, says what becomes
 * visible, and saves the profile straight after the account (`signUpFlow.ts`).
 */
export const AccountForm = ({ initialMode = "signin", onDone, intro, welcoming = false }: Props) => {
  const createAccount = useAccountStore((state) => state.createAccount);
  const adopt = useAccountStore((state) => state.adopt);
  const setMe = useCommunityStore((state) => state.setMe);
  const signIn = useAccountStore((state) => state.signIn);
  const requestReset = useAccountStore((state) => state.requestReset);
  const resetPassword = useAccountStore((state) => state.resetPassword);

  const [mode, setMode] = useState<AccountFormMode>(initialMode);
  // Forgotten password: the address a code was sent to, and for how long it lasts.
  const [codeSent, setCodeSent] = useState<{ email: string; minutes: number } | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Preselected at random, so a reader who skips past it still gets a Pip of their own.
  const [avatar, setAvatar] = useState(() => randomAvatar().id);
  // The handle starts as a suggestion and follows the name and email until
  // the reader types one of their own.
  const [typedHandle, setTypedHandle] = useState<string | null>(null);
  // On unless the reader turns it off. (A build without the community has
  // nothing to share a profile with, so there it is off and not shown.)
  const [share, setShare] = useState(FEATURES.community);
  // The account exists and this device is signed in, but its profile is not
  // shared yet (the handle was taken, the connection dropped): one step left.
  const [created, setCreated] = useState<AccountStatus | null>(null);
  const createdRef = useRef<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleId = useId();
  const handleNoteId = useId();
  const shareNoteId = useId();

  // Closed half-way (the dialog's X, another page): the account is real and
  // signed in, so the app is told, with a profile that stayed private.
  useEffect(
    () => () => {
      if (createdRef.current) {
        adopt(createdRef.current);
      }
    },
    [adopt]
  );

  const handle = typedHandle ?? (share ? suggestHandle(displayName, email) : "");
  // Needed to share; optional (but still a real handle, if given) otherwise.
  const handleFault = handle ? handleProblem(handle) : null;
  const handleReady = handle ? handleFault === null : !share;

  /** The sign-up is over: say who is signed in, and close. */
  const finish = (status: AccountStatus, profile: SocialProfile | null, message: string) => {
    createdRef.current = null;
    setCreated(null);
    if (profile) {
      setMe(profile);
    }
    adopt(status);
    setPassword("");
    setMode("signin");
    onDone(message);
  };

  const sharedMessage = (shared: string | null) => `Account created. You're signed in, and your profile is shared as ${at(shared)}.`;

  const submitSignUp = () => {
    setBusy(true);
    setError(null);
    signUpWithProfile(
      { create: createAccount, saveProfile: (update) => socialService.saveProfile(update) },
      { email: email.trim(), password, name: displayName, avatar, handle, share }
    )
      .then((outcome) => {
        if (outcome.kind === "created") {
          createdRef.current = outcome.status;
          setCreated(outcome.status);
          setTypedHandle(handle);
          setPassword("");
          setError(outcome.reason);
          return;
        }
        finish(
          outcome.status,
          outcome.profile,
          outcome.shared
            ? sharedMessage(outcome.profile?.handle ?? handle)
            : `Account created. You are signed in. Your profile is private.${outcome.note ? ` ${outcome.note}` : ""}`
        );
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  /** The step left over: share the profile of the account just created. */
  const shareCreated = () => {
    if (!created) {
      return;
    }
    setBusy(true);
    setError(null);
    socialService
      .saveProfile({ handle, displayName: displayName.trim(), visibility: "public" })
      .then((profile) => finish(created, profile, sharedMessage(profile.handle ?? handle)))
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const handleField = (
    <>
      <label htmlFor={handleId} className={labelClass}>
        Handle{share || created ? "" : " (optional)"}
      </label>
      <HandleField
        id={handleId}
        value={handle}
        onChange={setTypedHandle}
        describedBy={handleNoteId}
        invalid={Boolean(handleFault)}
        disabled={busy}
        className="text-xs"
      />
      <p id={handleNoteId} className="mt-1 text-[10px] text-on-surface-variant">
        {handleFault ?? (handle ? `Other readers find you as ${at(handle)}.` : COPY.handleHint)}
      </p>
    </>
  );

  const attempt = (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        setPassword("");
        setCode("");
        setCodeSent(null);
        setMode("signin");
        onDone(done);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const errorBox = error && (
    <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface" role="alert">
      {error}
    </p>
  );

  if (created) {
    return (
      <div>
        <p className="font-headline text-2xl font-bold text-on-surface">One thing left</p>
        <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
          Your account is created and you are signed in. Your profile isn't shared yet, so nobody else can see you.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (handleReady && handle && !busy) {
              shareCreated();
            }
          }}
        >
          {errorBox}
          {handleField}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !handle || !handleReady}
            >
              {busy ? "One moment…" : "Share my profile"}
            </button>
            <button
              type="button"
              className="text-xs text-on-surface-variant underline"
              disabled={busy}
              onClick={() => finish(created, null, `Account created. You are signed in. Your profile is private. ${COPY.shareLater}`)}
            >
              Keep it private for now
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === "reset") {
    const leave = () => {
      setMode("signin");
      setCodeSent(null);
      setCode("");
      setPassword("");
      setError(null);
    };
    const sendCode = () => {
      setBusy(true);
      setError(null);
      requestReset(email.trim())
        .then((minutes) => {
          setCodeSent({ email: email.trim(), minutes });
          setCode("");
        })
        .catch((cause) => setError(errorMessage(cause)))
        .finally(() => setBusy(false));
    };
    const codeReady = code.replace(/[^a-z0-9]/gi, "").length === 8 && password.length >= 8;
    return (
      <div>
        <p className="font-headline text-2xl font-bold text-on-surface">Reset your password</p>
        {!codeSent ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim() && !busy) {
                sendCode();
              }
            }}
          >
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
              We'll email you a code to set a new password. Your library on this computer is not affected.
            </p>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClass}
            />
            {errorBox}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !email.trim()}
              >
                {busy ? "One moment…" : "Email me a code"}
              </button>
              <button type="button" className="text-xs text-on-surface-variant underline" onClick={leave}>
                Back to sign in
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (codeReady && !busy) {
                attempt(() => resetPassword(codeSent.email, code, password), "Password changed. You are signed in.");
              }
            }}
          >
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
              If <span className="font-semibold text-on-surface">{codeSent.email}</span> has a Leaflet account, a code
              is on its way. It works for {codeSent.minutes} minutes. Not there after a minute? Check spam. (An
              account can be reset three times a year.)
            </p>
            <label className={labelClass}>Code from the email</label>
            <input
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              maxLength={12}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className={`${fieldClass} font-mono tracking-[0.2em]`}
            />
            <label className={labelClass}>New password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClass}
            />
            <p className="mt-1 text-[10px] text-on-surface-variant">
              At least 8 characters. Every device signed in to this account is signed out.
            </p>
            {errorBox}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !codeReady}
              >
                {busy ? "One moment…" : "Set password and sign in"}
              </button>
              <button type="button" className="text-xs text-on-surface-variant underline" disabled={busy} onClick={sendCode}>
                Send a new code
              </button>
              <button type="button" className="text-xs text-on-surface-variant underline" onClick={leave}>
                Back to sign in
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  const signingUp = mode === "signup";
  /** To the reset form, keeping the email already typed. */
  const forgotPassword = () => {
    setMode("reset");
    setCodeSent(null);
    setPassword("");
    setError(null);
  };
  const canSubmit = email.trim().length > 0 && password.length >= (signingUp ? 8 : 1) && (!signingUp || handleReady);
  const submit = () => (signingUp ? submitSignUp() : attempt(() => signIn(email.trim(), password), "Signed in."));

  return (
    <div>
      <p className="font-headline text-2xl font-bold text-on-surface">
        {signingUp ? (welcoming ? "Create your account" : "Create an account") : "Sign in"}
      </p>
      <div className="mt-2 text-xs leading-relaxed text-on-surface-variant">
        {intro ?? "Optional. Everything works without one. An account lets you join the leaderboard and share your shelf."}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !busy) {
            submit();
          }
        }}
      >
        <label className={labelClass}>Email</label>
        <input
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClass}
        />
        {signingUp && (
          <>
            <label className={labelClass}>Name (optional)</label>
            <input
              autoComplete="nickname"
              maxLength={40}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={fieldClass}
            />
            {FEATURES.community && handleField}
            <p className={`${labelClass} mb-2`}>Your Pip</p>
            <AvatarPicker value={avatar} onChange={setAvatar} disabled={busy} label="Your Pip" />
          </>
        )}
        <label className={labelClass}>Password</label>
        <input
          type="password"
          autoComplete={signingUp ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClass}
        />
        {signingUp ? (
          <>
            <p className="mt-1 text-[10px] text-on-surface-variant">At least 8 characters.</p>
            {FEATURES.community && (
            <>
            <button
              type="button"
              role="switch"
              aria-checked={share}
              aria-describedby={shareNoteId}
              className="inset-field mt-4 flex w-full items-center justify-between gap-4 px-3 py-2.5 text-xs text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setShare((on) => !on)}
              disabled={busy}
            >
              <span className="font-semibold">Share my profile</span>
              <span
                aria-hidden
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${share ? "bg-primary" : "bg-surface-container-highest"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${share ? "left-[18px]" : "left-0.5"}`}
                />
              </span>
            </button>
            <p id={shareNoteId} className="mt-1.5 text-[10px] leading-relaxed text-on-surface-variant">
              {share ? COPY.shareAtSignUp : COPY.privateAtSignUp}
            </p>
            </>
            )}
          </>
        ) : (
          <div className="mt-1 flex justify-end">
            <button type="button" className="text-[11px] font-semibold text-primary hover:underline" onClick={forgotPassword}>
              Forgot password?
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface" role="alert">
            <p>{error}</p>
            {/* A failed sign-in is exactly when a reset is wanted. */}
            {!signingUp && (
              <button type="button" className="mt-1 font-semibold text-primary underline" onClick={forgotPassword}>
                Reset your password with an emailed code
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || !canSubmit}
          >
            {busy ? "One moment…" : signingUp ? "Create account" : "Sign in"}
          </button>
          <button
            type="button"
            className="text-xs text-on-surface-variant underline"
            onClick={() => {
              setMode(signingUp ? "signin" : "signup");
              setError(null);
            }}
          >
            {signingUp ? "I have an account" : "Create an account"}
          </button>
        </div>
      </form>
      {signingUp && (PRIVACY_URL || TERMS_URL) && (
        <p className="mt-3 text-[10px] leading-relaxed text-on-surface-variant">
          By creating an account you agree to the{" "}
          {TERMS_URL && (
            <button type="button" className="underline" onClick={() => void accountService.openLink(TERMS_URL)}>
              terms
            </button>
          )}
          {TERMS_URL && PRIVACY_URL && " and "}
          {PRIVACY_URL && (
            <button type="button" className="underline" onClick={() => void accountService.openLink(PRIVACY_URL)}>
              privacy policy
            </button>
          )}
          .
        </p>
      )}
    </div>
  );
};
