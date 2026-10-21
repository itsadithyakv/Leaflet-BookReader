import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { DriveSyncStatus, SyncStatus } from "@shared/sync/types";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { useEquippedPip } from "../store/pipWardrobeStore";
import { PipAvatar } from "./community/PipAvatar";
import { relativeTime } from "./community/format";
import { PipSprite } from "./PipSprite";
import { UiIcon } from "./UiIcon";
import { useAccountDialog } from "./account/AccountDialog";
import { SheetHandle } from "./ui/SheetHandle";
import { useBackClose } from "../hooks/useBackClose";
import { usePhoneMenus, useSheetLayout } from "../hooks/useMediaQuery";
import { deviceNoun, isAndroid, useTouchInput } from "../platform/device";
import { OWNER_COPY } from "./sync/ownerCopy";

/**
 * How backup is set up. There is no paid tier: backup runs against the
 * reader's own storage.
 */
export type SyncMode = "off" | "folder" | "drive" | "account";

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
export const ProfileFace = ({ size }: { size: number }) => {
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
export const backupLine = (mode: SyncMode, status: DriveSyncStatus, sync: SyncStatus) => {
  // Another account's library: nothing of it is synced, by design.
  if (sync.library?.standing === "other" && status !== "syncing") return OWNER_COPY.paused;
  // Sync where several devices are kept in step, a backup where they are not (constants/features.ts).
  if (FEATURES.multiDeviceSync) {
    if (status === "syncing") return "Syncing…";
    if (status === "error") return "Sync failed";
    if (mode === "off") return "Not synced";
    return sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : "Sync on, nothing sent yet";
  }
  if (status === "syncing") return "Backing up…";
  if (status === "error") return "Backup failed";
  if (mode === "off") return "Not backed up";
  return sync.lastSyncedAt ? `Backed up ${relativeTime(sync.lastSyncedAt)}` : "Backup on, nothing sent yet";
};

/** The tooltip's words on backup: the line, and "Files only" where Drive or the folder carries only book files. */
export const backupTitle = (mode: SyncMode, status: DriveSyncStatus, sync: SyncStatus) => {
  const line = backupLine(mode, status, sync);
  const filesOnly = (sync.driveConnected && sync.driveFilesOnly) || (Boolean(sync.folderPath) && sync.folderFilesOnly);
  return filesOnly && line !== OWNER_COPY.paused ? `${line} · ${OWNER_COPY.filesOnly}` : line;
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  // On a phone the panel is a sheet from the bottom (at the side, held sideways), drawn
  // at the top of the page: inside the header (which slides away on scroll, and is not
  // there at all on Pip's tab sideways) a fixed sheet would hang from it.
  const narrow = useSheetLayout();
  const phoneMenus = usePhoneMenus();
  const sheet = narrow || phoneMenus;
  // By a finger (a phone, a tablet) Settings is here and nowhere else: the tab bar and the rail do not have it.
  const touch = useTouchInput();
  const android = isAndroid();
  useBackClose(open, onClose);

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
      const target = event.target as Node;
      // A sheet's backdrop takes its own tap, so that tap does not land on the page beneath.
      if (sheet || rootRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      onClose();
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
  }, [open, onClose, sheet]);

  const line = backupLine(mode, status, sync);
  const lineTitle = backupTitle(mode, status, sync);
  const ownerPaused = sync.library?.standing === "other";
  const who = account ? account.displayName || account.email : accountsOn ? "Not signed in" : "Your Pip";
  const failed = status === "error";
  const syncing = status === "syncing";
  const tooltip = `${account ? `${who}. ` : ""}${lineTitle}${sync.booksPending > 0 ? `. ${sync.booksPending} to download` : ""}`;
  const what = touch ? "Your profile, backup and settings" : "Your profile and backup";
  // Not on the phone: a sync folder there would do nothing.
  const showFolderSync = !android && (FEATURES.multiDeviceSync || Boolean(sync.folderPath));
  const section = "border-t border-outline-variant/40 pt-3 mt-3";
  const small = "tactile-button px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="relative" ref={rootRef} data-tour="backup">
      <button
        type="button"
        className={`profile-button ${syncing ? "profile-button-syncing" : ""} ${open ? "profile-button-open" : ""}`}
        onClick={onToggle}
        title={tooltip}
        aria-label={`${what}. ${tooltip}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* The whole button inside its 1px border (46px in index.css). */}
        <ProfileFace size={44} />
        {failed && <span className="profile-button-alert" aria-hidden="true" />}
      </button>

      {open && (
        <PanelFrame sheet={sheet} panelRef={panelRef} onClose={onClose} label={what}>
          {/* Who */}
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <ProfileFace size={52} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-on-surface" title={who}>
                {who}
              </p>
              {account ? (
                <p className="truncate text-[11px] text-on-surface-variant">{account.displayName ? account.email : "Leaflet account"}</p>
              ) : (
                !accountsOn && <p className="text-[11px] text-on-surface-variant">Everything works on this {deviceNoun()}.</p>
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
              <span
                className={`flex items-center gap-2 text-[11px] font-semibold ${failed ? "text-error" : "text-on-surface"}`}
                title={ownerPaused ? OWNER_COPY.pausedNote : lineTitle !== line ? lineTitle : undefined}
              >
                <UiIcon name={syncing ? "sync" : "cloud"} size={15} className={syncing ? "animate-spin" : ""} />
                {line}
              </span>
              {mode !== "off" && !ownerPaused && (
                <button type="button" className={small} onClick={onSyncNow} disabled={syncing}>
                  {failed ? "Try again" : FEATURES.multiDeviceSync ? "Sync now" : "Back up now"}
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
                  Google Drive isn't available in this build.
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
                  {FEATURES.multiDeviceSync && signedIn
                    ? OWNER_COPY.driveSignedIn
                    : FEATURES.multiDeviceSync
                    ? android
                      ? "Get your books from your computer: the same Google Drive on both."
                      : "Your books, places and streak in your own Google Drive, on every device."
                    : "Keep your books, progress and streak safe in your own Google Drive."}
                </p>
                <button type="button" className={`${small} tactile-button-primary mt-2 w-full`} onClick={onConnectDrive}>
                  {FEATURES.multiDeviceSync ? "Connect Google Drive" : "Back up to Google Drive"}
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

          {/* Where to next. By a finger Settings is a key of its own: this is the only way there. */}
          {touch && (
            <button type="button" className="profile-settings-row tactile-button mt-3 w-full" onClick={onOpenSettings}>
              <UiIcon name="settings" size={18} />
              <span className="flex-1 text-left">Settings</span>
              <ChevronRight size={16} className="text-on-surface-variant" aria-hidden />
            </button>
          )}
          <div className={`${section} flex items-center justify-between ${touch && !account ? "hidden" : ""}`}>
            {!touch && (
              <button type="button" className="flex items-center gap-1.5 py-1 text-[11px] font-semibold text-on-surface-variant hover:text-on-surface" onClick={onOpenSettings}>
                <UiIcon name="settings" size={14} /> Settings
              </button>
            )}
            {account && (
              <button
                type="button"
                className="touch-hit text-[11px] font-semibold text-on-surface-variant hover:text-on-surface"
                onClick={() => {
                  onClose();
                  void signOut();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </PanelFrame>
      )}
    </div>
  );
};

/** Hanging from the button, or, on a phone, a sheet over a dimmed page that a tap outside closes. */
const PanelFrame = ({
  sheet,
  panelRef,
  onClose,
  label,
  children
}: {
  sheet: boolean;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) => {
  if (!sheet) {
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        className="anchored-panel modal-surface absolute right-0 mt-3 w-80 rounded-xl p-4 text-xs text-on-surface"
      >
        {children}
      </div>
    );
  }
  return createPortal(
    <div
      className="sheet-backdrop sheet-backdrop-menu fixed inset-0 z-[80] flex items-end justify-center bg-black/45"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={panelRef} role="dialog" aria-label={label} className="modal-surface sheet-panel profile-sheet w-full p-4 text-xs text-on-surface">
        <SheetHandle onClose={onClose} />
        {children}
      </div>
    </div>,
    document.body
  );
};
