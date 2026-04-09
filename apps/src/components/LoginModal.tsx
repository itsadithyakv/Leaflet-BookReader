import { useState } from "react";

type LoginModalProps = {
  open: boolean;
  onClose: () => void;
  onLogin: (email: string) => void;
  onContinueOffline: () => void;
};

export const LoginModal = ({ open, onClose, onLogin, onContinueOffline }: LoginModalProps) => {
  const [email, setEmail] = useState("");

  if (!open) {
    return null;
  }

  const handleGoogle = () => {
    onLogin("reader@leaflet.app");
  };

  const handleEmail = () => {
    const trimmed = email.trim();
    if (!trimmed) {
      return;
    }
    onLogin(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-3xl border border-outline-variant/30 bg-surface-container-high p-6 shadow-2xl">
        <div className="text-center">
          <h2 className="text-xl font-headline font-bold text-on-surface">Welcome to Leaflet</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Sign in to enable cloud sync. Offline reading always works.
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm font-semibold text-on-surface transition hover:text-primary"
            onClick={handleGoogle}
          >
            <span className="material-symbols-outlined text-base">account_circle</span>
            Continue with Google
          </button>

          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
            <label className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Email</label>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
            />
            <button
              type="button"
              className="mt-3 w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
              onClick={handleEmail}
            >
              Continue with Email
            </button>
          </div>

          <button
            type="button"
            className="w-full rounded-full border border-outline-variant/30 px-4 py-2 text-xs uppercase tracking-[0.2em] text-on-surface-variant transition hover:text-primary"
            onClick={onContinueOffline}
          >
            Continue offline
          </button>
        </div>

        <button
          type="button"
          className="mt-4 w-full rounded-full border border-outline-variant/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-on-surface-variant transition hover:text-primary"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
};
