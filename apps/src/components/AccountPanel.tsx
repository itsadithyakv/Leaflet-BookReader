import type { DriveSyncStatus, SyncStatus } from "@shared/sync/types";
import type { SyncMode } from "./AccountBadge";
import { useEffect } from "react";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { PipAvatar } from "./community/PipAvatar";

type AccountPanelProps = {
  open: boolean;
  mode: SyncMode;
  status: DriveSyncStatus;
  sync: SyncStatus;
  error: string | null;
  onConnectDrive: () => void;
  onDisconnectDrive: () => void;
  onChooseFolder: () => void;
  onClearFolder: () => void;
  onSyncNow: () => void;
};

/**
 * What sync is doing, in terms the reader can act on.
 *
 * Nothing to pay for, and a Leaflet account is optional (it only unlocks the
 * leaderboard). Backup runs against storage the reader already owns, so the
 * main questions here are where it goes and whether it worked.
 */
export const AccountPanel = ({
  open,
  mode,
  status,
  sync,
  error,
  onConnectDrive,
  onDisconnectDrive,
  onChooseFolder,
  onClearFolder,
  onSyncNow
}: AccountPanelProps) => {
  const accountStatus = useAccountStore((state) => state.status);
  const loadAccount = useAccountStore((state) => state.load);
  const showAccount = FEATURES.accounts && Boolean(sync.apiBase);

  useEffect(() => {
    if (open && showAccount) {
      void loadAccount(false);
    }
  }, [open, showAccount, loadAccount]);

  if (!open) {
    return null;
  }

  const statusLabel =
    status === "syncing"
      ? "Backing up…"
      : status === "error"
        ? "Backup failed"
        : mode === "off"
          ? "Not backed up"
          : status === "success"
            ? "Backed up"
            : "Ready";

  const lastSyncedText = sync.lastSyncedAt
    ? new Date(sync.lastSyncedAt).toLocaleString()
    : "Not backed up yet";
  const showFolderSync = FEATURES.multiDeviceSync || Boolean(sync.folderPath);

  const initials = sync.accountEmail ? sync.accountEmail.slice(0, 2).toUpperCase() : "LF";
  const heading = sync.accountEmail ?? (mode === "folder" ? "Folder sync" : "This device only");

  return (
    <div className="anchored-panel modal-surface absolute right-0 mt-3 w-80 rounded-xl p-4 text-xs text-on-surface">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-on-surface">
          {initials}
        </div>
        <div className="flex-1">
          <div className="truncate text-sm font-semibold text-on-surface" title={heading}>
            {heading}
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            {statusLabel}
          </div>
        </div>
      </div>

      {error && status === "error" && (
        <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-[11px] leading-relaxed text-on-surface">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-outline-variant/40 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Backup</span>
          <button
            type="button"
            className="tactile-button px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSyncNow}
            disabled={mode === "off" || status === "syncing"}
          >
            Back up now
          </button>
        </div>
        <div className="mt-2 text-[11px] text-on-surface-variant">Last backup: {lastSyncedText}</div>
        {sync.booksPending > 0 && (
          <div className="mt-1 text-[11px] text-on-surface-variant">
            {sync.booksPending} {sync.booksPending === 1 ? "book" : "books"} will download when opened
          </div>
        )}
      </div>

      {showFolderSync && (
      <div className="mt-4 border-t border-outline-variant/40 pt-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Sync folder</div>
        {sync.folderPath ? (
          <>
            <div className="mt-2 break-all text-[11px] text-on-surface-variant">{sync.folderPath}</div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="tactile-button px-3 py-1.5 text-[10px] uppercase tracking-[0.16em]"
                onClick={onChooseFolder}
              >
                Change
              </button>
              <button
                type="button"
                className="tactile-button px-3 py-1.5 text-[10px] uppercase tracking-[0.16em]"
                onClick={onClearFolder}
              >
                Stop
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
              Point Leaflet at a folder your Drive, Dropbox or OneDrive app already syncs. No
              account needed.
            </p>
            <button
              type="button"
              className="tactile-button tactile-button-primary mt-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em]"
              onClick={onChooseFolder}
            >
              Choose folder
            </button>
          </>
        )}
      </div>
      )}

      {showAccount && (
        <div className="mt-4 border-t border-outline-variant/40 pt-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            Leaflet account
          </div>
          <div className="mt-2 flex items-center gap-2">
            {accountStatus.signedIn && accountStatus.account?.avatar && (
              <PipAvatar seed={null} avatar={accountStatus.account.avatar} size={28} />
            )}
            <span className="min-w-0 truncate text-[11px] text-on-surface-variant">
              {accountStatus.signedIn
                ? `Signed in as ${accountStatus.account?.displayName || accountStatus.account?.email || "you"}`
                : "Not signed in. Optional, in Settings."}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-outline-variant/40 pt-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Google Drive</div>
        {!sync.driveAvailable ? (
          <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
            This build has no Google credentials, so Drive backup is unavailable.
          </p>
        ) : sync.driveConnected ? (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-on-surface-variant">Connected</span>
            <button
              type="button"
              className="tactile-button px-3 py-1.5 text-[10px] uppercase tracking-[0.16em]"
              onClick={onDisconnectDrive}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-on-surface-variant">Not connected</span>
            <button
              type="button"
              className="tactile-button tactile-button-primary px-3 py-1.5 text-[10px] uppercase tracking-[0.16em]"
              onClick={onConnectDrive}
            >
              Connect
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
