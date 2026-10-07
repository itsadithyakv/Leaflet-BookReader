import { useState } from "react";
import { useAccountStore } from "../../store/accountStore";
import { errorMessage, type Account } from "../../services/accountService";
import { emailHint } from "./emailHint";
import { emailCodeReady } from "./signUpFlow";

type Props = {
  account: Account | null;
  showToast: (message: string) => void;
};

const fieldClass = "inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface";
const labelClass = "mt-3 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant";
const linkClass = "py-0.5 text-[11px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60";
const primaryClass = "tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The account's address, in Settings → Account: one row while it is not
 * confirmed (Confirm, Resend, Change), and the way to change it once it is.
 *
 * The only reminder there is. An address with a typo in it can never get a
 * password-reset email, so the row stays until the code is typed, and that
 * is all it does: no popup, no banner, nothing held back.
 *
 * Renders nothing when the server says nothing about confirmation (one from
 * before it existed): it has no code to send and none of these routes.
 */
export const AccountEmail = ({ account, showToast }: Props) => {
  const requestEmailCode = useAccountStore((state) => state.requestEmailCode);
  const confirmEmail = useAccountStore((state) => state.confirmEmail);
  const changeEmail = useAccountStore((state) => state.changeEmail);

  const [panel, setPanel] = useState<"none" | "code" | "change">("none");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!account || typeof account.emailConfirmed !== "boolean") {
    return null;
  }
  const confirmed = account.emailConfirmed;

  const open = (which: "none" | "code" | "change") => {
    setCode("");
    setAddress("");
    setPassword("");
    setHint(null);
    setError(null);
    setPanel(which);
  };

  /** Runs a call, then shows the code field unless the address is confirmed by now. */
  const attempt = (action: () => Promise<void>, done: (now: Account | null) => string) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        const now = useAccountStore.getState().status.account;
        open(now?.emailConfirmed === false ? "code" : "none");
        showToast(done(now));
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const resend = () =>
    attempt(requestEmailCode, (now) => (now?.emailConfirmed ? "Email confirmed." : `Code sent to ${now?.email ?? account.email}.`));
  const confirm = () => attempt(() => confirmEmail(code), () => "Email confirmed.");
  const change = () =>
    attempt(
      () => changeEmail(password, address.trim()),
      (now) => `Email changed. Code sent to ${now?.email ?? address.trim()}.`
    );

  const cancel = (
    <button type="button" className="tactile-button px-4 py-2 text-xs" disabled={busy} onClick={() => open("none")}>
      Cancel
    </button>
  );

  return (
    <div className="mt-2">
      {confirmed ? (
        panel === "none" && (
          <button type="button" className={linkClass} onClick={() => open("change")}>
            Change email
          </button>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="text-xs font-semibold text-on-surface"
            title="A password reset can only reach an address that works. Confirm yours with the code we email you."
          >
            Email not confirmed
          </span>
          <button type="button" className={linkClass} disabled={busy} onClick={() => open(panel === "code" ? "none" : "code")}>
            Confirm
          </button>
          <button type="button" className={linkClass} disabled={busy} onClick={resend}>
            Resend
          </button>
          <button type="button" className={linkClass} disabled={busy} onClick={() => open(panel === "change" ? "none" : "change")}>
            Change
          </button>
        </div>
      )}

      {panel === "code" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (emailCodeReady(code) && !busy) {
              confirm();
            }
          }}
        >
          <label className={labelClass}>
            Code from the email
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
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="submit" className={primaryClass} disabled={busy || !emailCodeReady(code)}>
              {busy ? "One moment…" : "Confirm"}
            </button>
            {cancel}
          </div>
        </form>
      )}

      {panel === "change" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim() && password && !busy) {
              change();
            }
          }}
        >
          <label className={labelClass}>
            New email
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setHint(null);
              }}
              onBlur={() => setHint(emailHint(address))}
              className={`${fieldClass} normal-case tracking-normal`}
            />
          </label>
          {hint && (
            <button
              type="button"
              className="mt-1 block text-left text-[11px] text-on-surface-variant hover:text-on-surface"
              onClick={() => {
                setAddress(hint);
                setHint(null);
              }}
            >
              Did you mean <span className="break-all font-semibold underline">{hint}</span>?
            </button>
          )}
          <label className={labelClass}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${fieldClass} normal-case tracking-normal`}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="submit"
              className={primaryClass}
              disabled={busy || !address.trim() || !password}
              title="The new address is sent a code to confirm it. Your devices stay signed in."
            >
              {busy ? "Saving…" : "Save email"}
            </button>
            {cancel}
          </div>
        </form>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
