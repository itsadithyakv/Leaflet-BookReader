import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SocialProfile } from "@shared/sync/types";
import { useAccountStore } from "../../store/accountStore";
import { accountService, errorMessage, type AccountStatus } from "../../services/accountService";
import { socialService } from "../../services/socialService";
import { FEATURES } from "../../constants/features";
import { PRIVACY_URL, TERMS_URL } from "../../constants/links";
import { randomAvatar } from "../../pip/avatars";
import { useCommunityStore } from "../community/communityStore";
import { COPY } from "../community/copy";
import { at } from "../community/format";
import { handleProblem, suggestHandle } from "../community/handle";
import { HandleField } from "../community/HandleField";
import { emailHint } from "./emailHint";
import { asksForEmailCode, emailCodeReady, signUpWithProfile } from "./signUpFlow";
import { deviceNoun } from "../../platform/device";
import { InfoTip } from "../ui/InfoTip";
import { SegmentedTabs, panelId, tabId } from "../ui/SegmentedTabs";
import { PasswordInput } from "./PasswordInput";
import { FieldError, fieldClass, linkClass, primaryClass, useKeepInView } from "./formParts";

export type AccountFormMode = "signin" | "signup" | "reset";

type Props = {
  initialMode?: AccountFormMode;
  /** After a sign-in, sign-up or reset: a line for a toast. */
  onDone: (message: string) => void;
  /** Room on the right of the top line for a dialog's close button. */
  besideClose?: boolean;
};

/** What an account is for, behind the (i) by the switch: the form itself says nothing about it. */
export const ACCOUNT_WHY =
  "Optional: everything works without one. An account keeps your reading in step across your devices and puts you on the weekly leaderboard.";

const MIN_PASSWORD = 8;
const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
/** A server's complaint about the address goes under the email; any other under the password. */
const aboutEmail = (message: string) => /email|address/i.test(message) && !/password is/i.test(message);
/**
 * Which field a failed call's message is shown under. With an emailed code on the form (a reset), a complaint about
 * the code is the code's ("That code is wrong or has expired" was shown under the new password, 2026-10-20).
 */
export const errorField = (message: string, withCode = false): "email" | "password" | "code" =>
  withCode && /\bcode\b/i.test(message) ? "code" : aboutEmail(message) ? "email" : "password";

const title = "font-headline text-lg font-bold text-on-surface";
const note = "mt-1 text-xs text-on-surface-variant";

/** "Code sent to x. Not there? Check Spam." (the mail is often taken for spam: the owner asked for it said, 2026-10-14). */
const CodeSent = ({ email, extra }: { email: string | undefined; extra?: string }) => (
  <p className={note}>
    Code sent to <span className="break-all font-semibold text-on-surface">{email}</span>. Not there? Check{" "}
    <span className="font-semibold text-on-surface">Spam</span>.{extra && <InfoTip text={extra} className="ml-1 align-[-2px]" />}
  </p>
);

/**
 * Signing in, creating an account, and a forgotten password, in one form.
 * Used by Settings → Account and the account dialog (the first-run offer, the
 * profile menu, Social's "Sign in"), so they can never drift apart.
 *
 * The switch between signing in and creating an account is the form's top
 * line, so it is in sight before anything else (it was under the whole
 * sign-up form, below the fold of a phone's sheet: the owner, 1.5.9).
 *
 * Creating an account asks for an email and a password, which is all the
 * server needs. Then, in a build with the community, one short step: a handle,
 * to share the profile (the default the button offers), or "Not now", which
 * leaves it private (`signUpFlow.ts`). Where the server confirms addresses,
 * the emailed code is asked for once after that, or "Later" (Settings →
 * Account keeps a row for it). Signing in never asks.
 */
export const AccountForm = ({ initialMode = "signin", onDone, besideClose = false }: Props) => {
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
  // Preselected at random, so every new reader has a Pip of their own; changed any time on their profile.
  const [avatar] = useState(() => randomAvatar().id);
  // The handle starts as a suggestion from the email until the reader types one of their own.
  const [typedHandle, setTypedHandle] = useState<string | null>(null);
  // The account exists and this device is signed in; its profile is not shared yet: the handle step.
  const [created, setCreated] = useState<AccountStatus | null>(null);
  const createdRef = useRef<AccountStatus | null>(null);
  // The account and its profile are settled, and the address is not yet
  // confirmed: the emailed code is asked for once, here, before the form
  // closes. Holds what the form will say when it does.
  const [confirming, setConfirming] = useState<{ status: AccountStatus; profile: SocialProfile | null; message: string } | null>(null);
  const sharedRef = useRef<SocialProfile | null>(null);
  const [resent, setResent] = useState(false);
  // "Did you mean …?" under the email, worked out when the field is left so
  // it does not come and go with every letter.
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each error under the field it is about.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ties each label to its field (the form can be on a page and in a dialog at once).
  const fieldId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  useKeepInView(rootRef, submitRef);
  // A step that follows another (the handle, the emailed code): the key pressed went with the step it was on, and the
  // focus with it, to the page (a keyboard's next Tab, a screen reader, started from the top of the app). It is put
  // on the new step's heading, which says what is asked now, without raising a phone's keyboard.
  const stepRef = useRef<HTMLHeadingElement | null>(null);
  const step = confirming ? "confirm" : created ? "handle" : mode === "reset" && codeSent ? "reset-code" : null;
  useEffect(() => {
    if (!step || typeof document === "undefined") return;
    const active = document.activeElement;
    if (!active || active === document.body || !document.body.contains(active) || rootRef.current?.contains(active)) stepRef.current?.focus();
  }, [step]);

  // Closed half-way (the dialog's X, another page): the account is real and
  // signed in, so the app is told, with a profile that stayed private.
  useEffect(
    () => () => {
      if (createdRef.current) {
        if (sharedRef.current) {
          setMe(sharedRef.current);
        }
        adopt(createdRef.current);
      }
    },
    [adopt, setMe]
  );

  const clearErrors = () => {
    setError(null);
    setEmailError(null);
    setPasswordError(null);
  };
  /** A failed call's message, under the field it is about. */
  const fail = (cause: unknown, withCode = false) => {
    const message = errorMessage(cause);
    // (On the reset's second form the line under the code is the email's: the address is not asked again there.)
    if (errorField(message, withCode) === "password") {
      setPasswordError(message);
    } else {
      setEmailError(message);
    }
  };

  const handle = typedHandle ?? suggestHandle("", email);
  const handleFault = handle ? handleProblem(handle) : null;

  /** The sign-up is over: say who is signed in, and close. */
  const finish = (status: AccountStatus, profile: SocialProfile | null, message: string) => {
    createdRef.current = null;
    sharedRef.current = null;
    setCreated(null);
    setConfirming(null);
    if (profile) {
      setMe(profile);
    }
    adopt(status);
    setPassword("");
    setCode("");
    setMode("signin");
    onDone(message);
  };

  /**
   * The account and its profile are settled. Where the server says the
   * address is not confirmed, one compact step is left: the emailed code, or
   * "Later". Closed instead, the account is handed over as it is.
   */
  const conclude = (status: AccountStatus, profile: SocialProfile | null, message: string) => {
    if (!asksForEmailCode(status)) {
      finish(status, profile, message);
      return;
    }
    createdRef.current = status;
    sharedRef.current = profile;
    setCreated(null);
    setPassword("");
    setCode("");
    setResent(false);
    clearErrors();
    setConfirming({ status, profile, message });
  };

  const submitSignUp = () => {
    setBusy(true);
    clearErrors();
    // The account alone: a handle (and sharing) is the next step's, where there is a community.
    signUpWithProfile(
      { create: createAccount, saveProfile: (update) => socialService.saveProfile(update) },
      { email: email.trim(), password, name: "", avatar, handle: "", share: false }
    )
      .then((outcome) => {
        setPassword("");
        if (FEATURES.community) {
          createdRef.current = outcome.status;
          setTypedHandle(null);
          setCreated(outcome.status);
          return;
        }
        conclude(outcome.status, null, "Account created. You're signed in.");
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  /** The handle step: share the profile of the account just created. */
  const shareCreated = () => {
    if (!created) {
      return;
    }
    setBusy(true);
    clearErrors();
    socialService
      .saveProfile({ handle, displayName: "", visibility: "public" })
      .then((profile) => conclude(created, profile, `Account created. Your profile is shared as ${at(profile.handle ?? handle)}.`))
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const attempt = (action: () => Promise<void>, done: string, withCode = false) => {
    setBusy(true);
    clearErrors();
    action()
      .then(() => {
        setPassword("");
        setCode("");
        setCodeSent(null);
        setMode("signin");
        onDone(done);
      })
      .catch((cause) => fail(cause, withCode))
      .finally(() => setBusy(false));
  };

  const codeField = (id: string, enterKeyHint: "done" | "next") => (
    <>
      <label htmlFor={id} className="sr-only">
        Code from the email
      </label>
      <input
        id={id}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        enterKeyHint={enterKeyHint}
        spellCheck={false}
        placeholder="Code (ABCD-EFGH)"
        maxLength={12}
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        className={`${fieldClass} mt-3 font-mono tracking-[0.15em]`}
      />
    </>
  );

  const submitButton = (label: string, disabled = false) => (
    <button ref={submitRef} type="submit" className={`${primaryClass} mt-4`} disabled={busy || disabled}>
      {busy ? "One moment…" : label}
    </button>
  );

  let body: ReactNode;

  if (confirming) {
    const confirmCode = () => {
      setBusy(true);
      clearErrors();
      accountService
        .confirmEmail(code)
        .then((status) => finish(status, confirming.profile, `${confirming.message} Email confirmed.`))
        .catch((cause) => setError(errorMessage(cause)))
        .finally(() => setBusy(false));
    };
    const resend = () => {
      setBusy(true);
      clearErrors();
      setResent(false);
      accountService
        .requestEmailCode()
        .then((status) => {
          // Confirmed meanwhile (on another device): nothing is left to ask.
          if (!asksForEmailCode(status)) {
            finish(status, confirming.profile, confirming.message);
            return;
          }
          createdRef.current = status;
          setCode("");
          setResent(true);
        })
        .catch((cause) => setError(errorMessage(cause)))
        .finally(() => setBusy(false));
    };
    body = (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (emailCodeReady(code) && !busy) {
            confirmCode();
          }
        }}
      >
        <h2 ref={stepRef} tabIndex={-1} className={`${title} focus:outline-none`}>
          Confirm your email
        </h2>
        <CodeSent email={confirming.status.account?.email} extra="A password reset can only reach an address that works." />
        {codeField(`${fieldId}-confirm-code`, "done")}
        <FieldError>{error}</FieldError>
        {resent && !error && (
          <p className={note} role="status">
            New code sent.
          </p>
        )}
        {submitButton("Confirm", !emailCodeReady(code))}
        <div className="mt-2 flex items-center justify-between gap-3">
          <button type="button" className={linkClass} disabled={busy} onClick={resend}>
            Resend code
          </button>
          <button
            type="button"
            className={linkClass}
            disabled={busy}
            title="Confirm it any time under Settings → Account."
            onClick={() => finish(confirming.status, confirming.profile, confirming.message)}
          >
            Later
          </button>
        </div>
      </form>
    );
  } else if (created) {
    const handleId = `${fieldId}-handle`;
    body = (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (handle && !handleFault && !busy) {
            shareCreated();
          }
        }}
      >
        <h2 ref={stepRef} tabIndex={-1} className={`${title} flex items-center gap-1.5 focus:outline-none`}>
          Pick a handle
          <InfoTip text={COPY.shareAtSignUp} />
        </h2>
        <label htmlFor={handleId} className="sr-only">
          Handle
        </label>
        <HandleField
          id={handleId}
          value={handle}
          onChange={setTypedHandle}
          invalid={Boolean(handleFault)}
          disabled={busy}
          className="text-sm"
          indent="pl-8"
          atClassName="left-3.5"
          wrapperClassName="mt-3"
        />
        <FieldError>{handleFault ?? error}</FieldError>
        {submitButton("Share my profile", !handle || Boolean(handleFault))}
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            className={linkClass}
            disabled={busy}
            title={COPY.privateAtSignUp}
            onClick={() => conclude(created, null, "Account created. Your profile is private.")}
          >
            Not now
          </button>
        </div>
      </form>
    );
  } else if (mode === "reset") {
    const leave = () => {
      setMode("signin");
      setCodeSent(null);
      setCode("");
      setPassword("");
      clearErrors();
    };
    const sendCode = () => {
      if (!looksLikeEmail(email.trim())) {
        setEmailError(email.trim() ? "That doesn't look like an email address." : "Enter your email.");
        return;
      }
      setBusy(true);
      clearErrors();
      requestReset(email.trim())
        .then((minutes) => {
          setCodeSent({ email: email.trim(), minutes });
          setCode("");
        })
        .catch(fail)
        .finally(() => setBusy(false));
    };
    body = !codeSent ? (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) {
            sendCode();
          }
        }}
      >
        <h2 className={`${title} flex items-center gap-1.5`}>
          Reset password
          <InfoTip text={`We email you a code to set a new one. Your library on this ${deviceNoun()} is not affected.`} />
        </h2>
        <label htmlFor={`${fieldId}-reset-email`} className="sr-only">
          Email
        </label>
        <input
          id={`${fieldId}-reset-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          enterKeyHint="send"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Email"
          aria-invalid={Boolean(emailError) || undefined}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
          className={`${fieldClass} mt-3`}
        />
        <FieldError>{emailError ?? passwordError}</FieldError>
        {submitButton("Email me a code")}
        <div className="mt-2 flex justify-center">
          <button type="button" className={linkClass} onClick={leave}>
            Back to sign in
          </button>
        </div>
      </form>
    ) : (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) {
            return;
          }
          if (!emailCodeReady(code)) {
            setEmailError("Enter the 8-character code from the email.");
            return;
          }
          if (password.length < MIN_PASSWORD) {
            setPasswordError(`Use at least ${MIN_PASSWORD} characters.`);
            return;
          }
          attempt(() => resetPassword(codeSent.email, code, password), "Password changed. You're signed in.", true);
        }}
      >
        <h2 ref={stepRef} tabIndex={-1} className={`${title} focus:outline-none`}>
          Reset password
        </h2>
        <CodeSent
          email={codeSent.email}
          extra={`If it has a Leaflet account. The code works for ${codeSent.minutes} minutes; an account can be reset three times a year.`}
        />
        {codeField(`${fieldId}-reset-code`, "next")}
        <FieldError>{emailError}</FieldError>
        <label htmlFor={`${fieldId}-reset-password`} className="sr-only">
          New password
        </label>
        <span className="mt-2 block">
          <PasswordInput
            id={`${fieldId}-reset-password`}
            name="new-password"
            enterKeyHint="go"
            autoComplete="new-password"
            placeholder={`New password (${MIN_PASSWORD}+ characters)`}
            aria-invalid={Boolean(passwordError) || undefined}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(null);
            }}
            className={fieldClass}
          />
        </span>
        <FieldError>{passwordError}</FieldError>
        {submitButton("Set password")}
        <div className="mt-2 flex items-center justify-between gap-3">
          <button type="button" className={linkClass} disabled={busy} onClick={sendCode}>
            Resend code
          </button>
          <button type="button" className={linkClass} onClick={leave}>
            Back to sign in
          </button>
        </div>
      </form>
    );
  } else {
    const signingUp = mode === "signup";
    /** To the reset form, keeping the email already typed. */
    const forgotPassword = () => {
      setMode("reset");
      setCodeSent(null);
      setPassword("");
      clearErrors();
    };
    const submit = () => {
      const address = email.trim();
      const emailProblem = !address ? "Enter your email." : looksLikeEmail(address) ? null : "That doesn't look like an email address.";
      const passwordProblem = !password
        ? "Enter your password."
        : signingUp && password.length < MIN_PASSWORD
          ? `Use at least ${MIN_PASSWORD} characters.`
          : null;
      setEmailError(emailProblem);
      setPasswordError(passwordProblem);
      setError(null);
      if (emailProblem || passwordProblem) {
        return;
      }
      if (signingUp) {
        submitSignUp();
      } else {
        attempt(() => signIn(address, password), "Signed in.");
      }
    };
    const prefix = `${fieldId}-switch`;
    body = (
      <>
        <div className={`flex items-center gap-2 ${besideClose ? "pr-9" : ""}`}>
          <div className="min-w-0 flex-1">
            <SegmentedTabs<"signin" | "signup">
              label="Sign in or create an account"
              idPrefix={prefix}
              tabs={[
                { id: "signin", label: "Sign in" },
                { id: "signup", label: "Create account" }
              ]}
              value={signingUp ? "signup" : "signin"}
              size="md"
              onChange={(next) => {
                setMode(next);
                clearErrors();
              }}
              className="account-switch w-full [&>.segmented-tab]:!flex-auto [&>.segmented-tab]:whitespace-nowrap"
            />
          </div>
          <InfoTip text={ACCOUNT_WHY} />
        </div>
        <form
          id={panelId(prefix, signingUp ? "signup" : "signin")}
          role="tabpanel"
          aria-labelledby={tabId(prefix, signingUp ? "signup" : "signin")}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) {
              submit();
            }
          }}
        >
          <label htmlFor={`${fieldId}-email`} className="sr-only">
            Email
          </label>
          <input
            id={`${fieldId}-email`}
            name="email"
            type="email"
            inputMode="email"
            // The email is the account's name: "username" is what a phone's password manager pairs with the password.
            autoComplete="username"
            enterKeyHint="next"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Email"
            aria-invalid={Boolean(emailError) || undefined}
            aria-describedby={emailError ? `${fieldId}-email-error` : undefined}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setHint(null);
              setEmailError(null);
            }}
            onBlur={() => setHint(emailHint(email))}
            className={`${fieldClass} mt-4`}
          />
          <FieldError id={`${fieldId}-email-error`}>{emailError}</FieldError>
          {signingUp && hint && !emailError && (
            <button
              type="button"
              className="mt-1 block text-left text-xs text-on-surface-variant hover:text-on-surface"
              onClick={() => {
                setEmail(hint);
                setHint(null);
              }}
            >
              Did you mean <span className="break-all font-semibold underline">{hint}</span>?
            </button>
          )}
          <label htmlFor={`${fieldId}-password`} className="sr-only">
            Password
          </label>
          <span className="mt-2 block">
            <PasswordInput
              id={`${fieldId}-password`}
              name="password"
              enterKeyHint="go"
              autoComplete={signingUp ? "new-password" : "current-password"}
              placeholder={signingUp ? `Password (${MIN_PASSWORD}+ characters)` : "Password"}
              aria-invalid={Boolean(passwordError) || undefined}
              aria-describedby={passwordError ? `${fieldId}-password-error` : undefined}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
              }}
              className={fieldClass}
            />
          </span>
          <div className="flex items-start justify-between gap-3">
            <FieldError id={`${fieldId}-password-error`}>{passwordError}</FieldError>
            {!signingUp && (
              <button type="button" className={`${linkClass} ml-auto shrink-0`} onClick={forgotPassword}>
                Forgot password?
              </button>
            )}
          </div>
          {submitButton(signingUp ? "Create account" : "Sign in")}
          {signingUp && (TERMS_URL || PRIVACY_URL) && (
            <p className="mt-3 text-center text-[11px] text-on-surface-variant">
              By continuing you agree to the{" "}
              {TERMS_URL && (
                <button type="button" className="underline hover:text-on-surface" onClick={() => void accountService.openLink(TERMS_URL)}>
                  Terms
                </button>
              )}
              {TERMS_URL && PRIVACY_URL && " and "}
              {PRIVACY_URL && (
                <button type="button" className="underline hover:text-on-surface" onClick={() => void accountService.openLink(PRIVACY_URL)}>
                  Privacy Policy
                </button>
              )}
              .
            </p>
          )}
        </form>
      </>
    );
  }

  return (
    <div ref={rootRef} className="account-form">
      {body}
    </div>
  );
};
