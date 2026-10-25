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
import { useAdminPage } from "./admin/AdminHost";
import { useCommunityStore } from "./community/communityStore";
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

/** When the last whole sync was, said shortly: a time today, a day before then. */
const since = (iso: string, now: Date) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * A failed sync, said honestly: since when nothing has got through
 * ("Couldn't sync since 19 Oct"), not only that the last try failed. Sync
 * can fail at every try for days, and "Sync failed" read the same on the
 * first day as on the fifth (2026-10-21).
 */
export const failedLine = (sync: Pick<SyncStatus, "lastSyncedAt">, now = new Date()) => {
  const words = FEATURES.multiDeviceSync ? "Couldn't sync" : "Couldn't back up";
  const when = sync.lastSyncedAt ? since(sync.lastSyncedAt, now) : null;
  return when ? `${words} since ${when}` : words;
};

/**
 * A device that used to sync and now has nothing to sync through: signed out
 * of the account, with no Drive and no folder. Its reading stays on it, and
 * the other devices never hear of it (2026-10-25: a phone kept 42% while the
 * laptop showed 29%, and nothing said why). A device that never synced is
 * left alone: one device on its own is a choice, not a fault.
 */
export const stranded = (mode: SyncMode, sync: Pick<SyncStatus, "lastSyncedAt" | "library">) =>
  FEATURES.multiDeviceSync && mode === "off" && Boolean(sync.lastSyncedAt) && sync.library?.standing !== "other";

/**
 * Google refusing Drive, in a few words, or null: Leaflet's client disabled
 * (nothing for the reader to do), or the reader's grant gone (connect again).
 * Not a failed sync: the account carries the reading meanwhile.
 */
export const driveLine = (sync: Pick<SyncStatus, "driveConnected" | "driveUnavailable">) => {
  if (!sync.driveConnected) return null;
  if (sync.driveUnavailable === "client_disabled") return "Google Drive is unavailable right now";
  if (sync.driveUnavailable === "reconnect") return "Reconnect Google Drive";
  return null;
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
    if (status === "error") return failedLine(sync);
    if (stranded(mode, sync)) return `Not syncing since ${since(sync.lastSyncedAt as string, new Date())}`;
    if (mode === "off") return "Not synced";
    return sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : "Sync on, nothing sent yet";
  }
  if (status === "syncing") return "Backing up…";
  if (status === "error") return failedLine(sync);
  if (mode === "off") return "Not backed up";
  return sync.lastSyncedAt ? `Backed up ${relativeTime(sync.lastSyncedAt)}` : "Backup on, nothing sent yet";
};

/** The account's copy filling up, in a few words, or null (sync audit D2). */
export const roomLine = (sync: Pick<SyncStatus, "accountUsage">) =>
  sync.accountUsage ? OWNER_COPY.roomLine(sync.accountUsage.bytes, sync.accountUsage.limit) : null;

/** The tooltip's words on backup: the line, and "Files only" where Drive or the folder carries only book files. */
export const backupTitle = (mode: SyncMode, status: DriveSyncStatus, sync: SyncStatus) => {
  const line = backupLine(mode, status, sync);
  if (line === OWNER_COPY.paused) return line;
  const filesOnly = (sync.driveConnected && sync.driveFilesOnly) || (Boolean(sync.folderPath) && sync.folderFilesOnly);
  return [line, filesOnly ? OWNER_COPY.filesOnly : null, driveLine(sync), roomLine(sync)].filter(Boolean).join(" · ");
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
  const showAdmin = useAdminPage((state) => state.show);
  const accountsOn = FEATURES.accounts && Boolean(sync.apiBase);
  const signedIn = accountsOn && accountStatus.signedIn;
  const account = signedIn ? accountStatus.account : null;
  // The owner's own page, for the account the server calls the admin (its
  // own profile says so, private or not); nobody else is offered it.
  const isAdmin = useCommunityStore((state) => Boolean(state.me?.isAdmin));
  const meLoaded = useCommunityStore((state) => state.me !== null);
  const loadMe = useCommunityStore((state) => state.loadMe);
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

  // Who is signed in is asked for when the menu first opens, if nothing has asked yet.
  useEffect(() => {
    if (open && signedIn && FEATURES.community && !meLoaded) {
      void loadMe();
    }
  }, [open, signedIn, meLoaded, loadMe]);

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
  // The same dot as a failed sync: either way this device's reading is not reaching the others.
  const alert = failed || stranded(mode, sync);
  const syncing = status === "syncing";
  const driveRefused = driveLine(sync);
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
        {alert && <span className="profile-button-alert" aria-hidden="true" />}
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
          {account && isAdmin && (
            <button
              type="button"
              className="profile-settings-row tactile-button mt-2 w-full"
              onClick={() => {
                onClose();
                showAdmin();
              }}
            >
              <UiIcon name="analytics" size={18} />
              <span className="flex-1 text-left">Admin</span>
              <ChevronRight size={16} className="text-on-surface-variant" aria-hidden />
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
            {roomLine(sync) && (
              <p className="mt-2 text-[11px] text-on-surface-variant" title={OWNER_COPY.roomNote}>
                {roomLine(sync)}
              </p>
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
              <>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                  <span className="min-w-0 truncate" title={sync.accountEmail ?? undefined}>
                    {sync.driveUnavailable === "client_disabled"
                      ? driveRefused
                      : `Google Drive${sync.accountEmail ? ` · ${sync.accountEmail}` : ""}`}
                  </span>
                  <button type="button" className="shrink-0 underline hover:text-on-surface" onClick={onDisconnectDrive}>
                    Disconnect
                  </button>
                </div>
                {sync.driveUnavailable === "reconnect" && (
                  <button type="button" className={`${small} tactile-button-primary mt-2 w-full`} onClick={onConnectDrive}>
                    {driveRefused}
                  </button>
                )}
              </>
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
