import { useEffect, useRef } from "react";
import type { DriveSyncStatus, SyncStatus } from "@shared/sync/types";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { useEquippedPip } from "../store/pipWardrobeStore";
import { PipAvatar } from "./community/PipAvatar";
import { relativeTime } from "./community/format";
import { PipSprite } from "./PipSprite";
import { UiIcon } from "./UiIcon";
import { useAccountDialog } from "./account/AccountDialog";

/**
 * How backup is set up. There is no paid tier: backup runs against the
 * reader's own storage.
 */
export type SyncMode = "off" | "folder" | "drive";

type Props = {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  mode: SyncMode;
  status: DriveSyncStatus;
  sync: SyncStatus;
  error: string | null;
  onConnectDrive: () => void;
  onDisconnectDrive: () => void;
  onChooseFolder: () => void;
  onClearFolder: () => void;
  onSyncNow: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
};

/**
 * The reader's face in the header: their account's Pip, or the Pip they dress
 * on the Pip tab. A portrait either way: Pip fills the round frame.
 */
const Face = ({ size }: { size: number }) => {
  const account = useAccountStore((state) => (state.status.signedIn ? state.status.account : null));
  const equipped = useEquippedPip();
  if (account?.avatar) {
    return <PipAvatar seed={null} avatar={account.avatar} size={size} />;
  }
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      <PipSprite move="idle" still portrait size={size} skin={equipped.skin} outfit={equipped.outfit} />
    </span>
  );
};

/**
 * One line on the state of backup, for the button's tooltip and the menu.
 * Quiet when all is well: "Backed up 5m ago", not a badge that says so forever.
 */
const backupLine = (mode: SyncMode, status: DriveSyncStatus, sync: SyncStatus) => {
  if (status === "syncing") return "Backing up…";
  if (status === "error") return "Backup failed";
  if (mode === "off") return "Not backed up";
  return sync.lastSyncedAt ? `Backed up ${relativeTime(sync.lastSyncedAt)}` : "Backup on, nothing sent yet";
};

/**
 * The header's profile button and its menu: who you are, whether your library
 * is backed up, and the way to your profile and settings.
 *
 * It replaced a pill that read "Backed up" all day. Backup still shows here,
 * but only when it needs you: a ring while it runs, a red dot when it failed.
 */
export const ProfileButton = ({
  open,
  onToggle,
  onClose,
  mode,
  status,
  sync,
  error,
  onConnectDrive,
  onDisconnectDrive,
  onChooseFolder,
  onClearFolder,
  onSyncNow,
  onOpenSettings,
  onOpenProfile
}: Props) => {
  const accountStatus = useAccountStore((state) => state.status);
  const loadAccount = useAccountStore((state) => state.load);
  const signOut = useAccountStore((state) => state.signOut);
  const showAccountDialog = useAccountDialog((state) => state.show);
  const accountsOn = FEATURES.accounts && Boolean(sync.apiBase);
  const signedIn = accountsOn && accountStatus.signedIn;
  const account = signedIn ? accountStatus.account : null;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (accountsOn) {
      void loadAccount(false);
    }
  }, [accountsOn, loadAccount]);

  // Closes on a click elsewhere and on Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const line = backupLine(mode, status, sync);
  const who = account ? account.displayName || account.email : accountsOn ? "Not signed in" : "Your Pip";
  const failed = status === "error";
  const syncing = status === "syncing";
  const tooltip = `${account ? `${who}. ` : ""}${line}${sync.booksPending > 0 ? `. ${sync.booksPending} to download` : ""}`;
  const showFolderSync = FEATURES.multiDeviceSync || Boolean(sync.folderPath);
  const section = "border-t border-outline-variant/40 pt-3 mt-3";
  const small = "tactile-button px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="relative" ref={rootRef} data-tour="backup">
      <button
        type="button"
        className={`profile-button ${syncing ? "profile-button-syncing" : ""} ${open ? "profile-button-open" : ""}`}
        onClick={onToggle}
        title={tooltip}
        aria-label={`Your profile and backup. ${tooltip}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* The whole button inside its 1px border (46px in index.css). */}
        <Face size={44} />
        {failed && <span className="profile-button-alert" aria-hidden="true" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your profile and backup"
          className="anchored-panel modal-surface absolute right-0 mt-3 w-80 rounded-xl p-4 text-xs text-on-surface"
        >
          {/* Who */}
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Face size={52} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-on-surface" title={who}>
                {who}
              </p>
              {account ? (
                <p className="truncate text-[11px] text-on-surface-variant">{account.displayName ? account.email : "Leaflet account"}</p>
              ) : (
                <p className="text-[11px] text-on-surface-variant">
                  {accountsOn ? "An account puts you on the leaderboard." : "Everything works on this computer."}
                </p>
              )}
            </div>
          </div>
          {accountsOn && !account && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="tactile-button tactile-button-primary px-3 py-2 text-xs font-semibold"
                onClick={() => {
                  onClose();
                  showAccountDialog("signin");
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className="tactile-button px-3 py-2 text-xs font-semibold"
                onClick={() => {
                  onClose();
                  showAccountDialog("signup");
                }}
              >
                Create account
              </button>
            </div>
          )}
          {account && FEATURES.community && (
            <button type="button" className={`${small} mt-3 w-full`} onClick={onOpenProfile}>
              Your profile
            </button>
          )}

          {/* Backup */}
          <div className={section}>
            <div className="flex items-center justify-between gap-2">
              <span className={`flex items-center gap-2 text-[11px] font-semibold ${failed ? "text-error" : "text-on-surface"}`}>
                <UiIcon name={syncing ? "sync" : "cloud"} size={15} className={syncing ? "animate-spin" : ""} />
                {line}
              </span>
              {mode !== "off" && (
                <button type="button" className={small} onClick={onSyncNow} disabled={syncing}>
                  {failed ? "Try again" : "Back up now"}
                </button>
              )}
            </div>
            {error && failed && (
              <p className="mt-2 rounded-lg bg-error-container/40 px-3 py-2 text-[11px] leading-relaxed text-on-surface">{error}</p>
            )}
            {sync.booksPending > 0 && (
              <p className="mt-2 text-[11px] text-on-surface-variant">
                {sync.booksPending} {sync.booksPending === 1 ? "book" : "books"} will download when opened.
              </p>
            )}
            {!sync.driveAvailable ? (
              mode === "off" && (
                <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
                  Drive backup isn't available in this build.
                </p>
              )
            ) : sync.driveConnected ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                <span className="min-w-0 truncate" title={sync.accountEmail ?? undefined}>
                  Google Drive{sync.accountEmail ? ` · ${sync.accountEmail}` : ""}
                </span>
                <button type="button" className="shrink-0 underline hover:text-on-surface" onClick={onDisconnectDrive}>
                  Disconnect
                </button>
              </div>
            ) : (
              <>
                <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
                  Keep your books, progress and streak safe in your own Google Drive.
                </p>
                <button type="button" className={`${small} tactile-button-primary mt-2 w-full`} onClick={onConnectDrive}>
                  Back up to Google Drive
                </button>
              </>
            )}
          </div>

          {showFolderSync && (
            <div className={section}>
              <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Sync folder</div>
              {sync.folderPath ? (
                <>
                  <div className="mt-2 break-all text-[11px] text-on-surface-variant">{sync.folderPath}</div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={small} onClick={onChooseFolder}>
                      Change
                    </button>
                    <button type="button" className={small} onClick={onClearFolder}>
                      Stop
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className={`${small} mt-2`} onClick={onChooseFolder}>
                  Choose a sync folder
                </button>
              )}
            </div>
          )}

          {/* Where to next */}
          <div className={`${section} flex items-center justify-between`}>
            <button type="button" className="flex items-center gap-1.5 py-1 text-[11px] font-semibold text-on-surface-variant hover:text-on-surface" onClick={onOpenSettings}>
              <UiIcon name="settings" size={14} /> Settings
            </button>
            {account && (
              <button
                type="button"
                className="text-[11px] font-semibold text-on-surface-variant hover:text-on-surface"
                onClick={() => {
                  onClose();
                  void signOut();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
