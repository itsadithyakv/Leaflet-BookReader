import { useState, type ReactNode } from "react";
import { useAccountStore } from "../../store/accountStore";
import { accountService, errorMessage } from "../../services/accountService";
import { PRIVACY_URL, TERMS_URL } from "../../constants/links";
import { randomAvatar } from "../../pip/avatars";
import { AvatarPicker } from "../AvatarPicker";

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
 */
export const AccountForm = ({ initialMode = "signin", onDone, intro, welcoming = false }: Props) => {
  const signUp = useAccountStore((state) => state.signUp);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const canSubmit = email.trim().length > 0 && password.length >= (signingUp ? 8 : 1);
  const submit = () =>
    attempt(
      () => (signingUp ? signUp(email.trim(), password, displayName, avatar) : signIn(email.trim(), password)),
      signingUp ? "Account created. You are signed in." : "Signed in."
    );

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
          <p className="mt-1 text-[10px] text-on-surface-variant">At least 8 characters.</p>
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
