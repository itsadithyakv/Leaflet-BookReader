type AccountTier = "offline" | "cloud" | "premium";
type SyncState = "offline" | "pending" | "synced" | "error";

type AccountPanelProps = {
  open: boolean;
  tier: AccountTier;
  syncState: SyncState;
  email: string | null;
  lastSyncedAt: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onUpgrade: () => void;
  onRestore: () => void;
  onSyncNow: () => void;
};

export const AccountPanel = ({
  open,
  tier,
  syncState,
  email,
  lastSyncedAt,
  onSignIn,
  onSignOut,
  onUpgrade,
  onRestore,
  onSyncNow
}: AccountPanelProps) => {
  if (!open) {
    return null;
  }

  const statusLabel = tier === "premium" ? "Premium" : tier === "cloud" ? "Free" : "Offline";
  const syncLabel =
    syncState === "pending" ? "Syncing…" : syncState === "synced" ? "Synced" : syncState === "error" ? "Sync paused" : "Offline";
  const lastSyncedText = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Not synced yet";

  return (
    <div className="absolute right-0 mt-3 w-80 rounded-2xl border border-outline-variant/30 bg-surface-container-high p-4 text-xs text-on-surface shadow-2xl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-on-surface">
          {email ? email.slice(0, 2).toUpperCase() : "LF"}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-on-surface">{email ?? "Offline mode"}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            {statusLabel} account
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Sync</div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-on-surface-variant">{syncLabel}</span>
          <button
            type="button"
            className="rounded-full border border-outline-variant/30 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-on-surface transition hover:text-primary"
            onClick={onSyncNow}
          >
            Sync now
          </button>
        </div>
        <div className="mt-2 text-[11px] text-on-surface-variant">Last synced: {lastSyncedText}</div>
      </div>

      <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Premium</div>
        {tier === "premium" ? (
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-on-surface-variant">Premium active</span>
            <button
              type="button"
              className="rounded-full border border-outline-variant/30 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-on-surface transition hover:text-primary"
              onClick={onRestore}
            >
              Restore
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-on-surface-variant">Cloud sync + extras</span>
            <button
              type="button"
              className="rounded-full bg-primary px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-on-primary"
              onClick={onUpgrade}
            >
              Upgrade
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <button
          type="button"
          className="rounded-full border border-outline-variant/30 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-on-surface transition hover:text-primary"
          onClick={onSignIn}
        >
          {tier === "offline" ? "Sign in" : "Manage account"}
        </button>
        {tier !== "offline" && (
          <button
            type="button"
            className="rounded-full border border-outline-variant/30 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant transition hover:text-primary"
            onClick={onSignOut}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
};
