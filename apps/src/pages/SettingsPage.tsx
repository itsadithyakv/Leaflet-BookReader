import { useEffect, useState } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useShallow } from "zustand/react/shallow";
import { flowerGrowing, useHabitStore } from "../store/habitStore";
import { askConfirm } from "../components/ConfirmDialog";
import { useAppearanceStore, type ThemeMode } from "../store/appearanceStore";
import { converterService, type ConverterInfo } from "../services/converterService";
import { dependencyFreeSummary, externalConverterCount } from "../constants/bookFormats";
import { bookService } from "../services/bookService";
import {
  clearSmartReadProfiles,
  loadSmartReadCalibration,
  normalizeSmartReadCalibration,
  saveSmartReadCalibration,
  type SmartReadCalibration
} from "../services/smartReadService";
import { UiIcon } from "../components/UiIcon";
import { RemindersCard } from "../components/RemindersCard";
import { getPlatform, pickSyncFolder } from "../platform";
import { FEATURES } from "../constants/features";
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from "../constants/links";
import { openStoreReview } from "../components/RatePrompt";
import { useAccountStore } from "../store/accountStore";
import { accountService, errorMessage } from "../services/accountService";
import { diagnosticsService } from "../services/diagnosticsService";
import { AccountForm } from "../components/account/AccountForm";
import { PipAvatar } from "../components/community/PipAvatar";
import { usePipStore, type PipMode } from "../store/pipStore";
import { pickBeat } from "../pip/moments";

const PIP_MODES: Array<{ mode: PipMode; label: string; detail: string; preview: string }> = [
  { mode: "chatty", label: "Chatty", detail: "Pip lives out in the app: it wanders, naps, celebrates, and can be picked up and thrown. Select the logo to call it home.", preview: "look" },
  { mode: "quiet", label: "Quiet", detail: "Pip stays in the logo and only comes out when something happens: a goal, a streak, a finished book.", preview: "idle" },
  { mode: "off", label: "Off", detail: "Pip stays still as the logo. Session summaries still appear, without Pip.", preview: "sleep" }
];

export type SettingsPageProps = {
  showToast: (message: string) => void;
};

export const SettingsPage = ({ showToast }: SettingsPageProps) => {
  const {
    sync,
    syncStatus,
    syncError,
    startDriveAuth,
    disconnectDrive,
    setSyncFolder,
    setCloudApi,
    setDriveCredentials,
    clearDriveCredentials,
    syncNow,
    loadSyncStatus,
    resetAll: resetLibrary
  } = useLibraryStore();
  const {
    focusSettings,
    setFocusSettings,
    goalMinutes,
    setGoalMinutes,
    resetAll: resetHabits
  } = useHabitStore(
    useShallow((state) => ({
      focusSettings: state.focusSettings,
      setFocusSettings: state.setFocusSettings,
      goalMinutes: state.snapshot.goalMinutes,
      setGoalMinutes: state.setGoalMinutes,
      resetAll: state.resetAll
    }))
  );
  // Reader calibration is keyed on the connected Google account when there is
  // one. It used to key on whatever had been typed into a sign-in modal.
  const accountEmail = sync.accountEmail;
  const theme = useAppearanceStore((state) => state.theme);
  const followSystem = useAppearanceStore((state) => state.followSystem);
  const followSystemTheme = useAppearanceStore((state) => state.followSystemTheme);
  const setTheme = useAppearanceStore((state) => state.setTheme);
  const resetAppearance = useAppearanceStore((state) => state.resetTheme);
  const pipMode = usePipStore((state) => state.mode);
  const setPipMode = usePipStore((state) => state.setMode);
  const startPipTour = usePipStore((state) => state.startTour);
  const pipChoice = PIP_MODES.find((item) => item.mode === pipMode) ?? PIP_MODES[0];
  const [converter, setConverter] = useState<ConverterInfo>({
    installed: false,
    path: null,
    canAutoInstall: false
  });
  const [converterBusy, setConverterBusy] = useState(false);
  // The converter is compiled out of mobile builds entirely -- there is no
  // Calibre for Android -- so the card must not offer something unreachable.
  const converterSupported = getPlatform() === "desktop";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDriveSetup, setShowDriveSetup] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [apiBase, setApiBase] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [smartReadCalibration, setSmartReadCalibration] = useState<SmartReadCalibration>(() =>
    loadSmartReadCalibration(accountEmail)
  );

  useEffect(() => {
    converterService
      .status()
      .then(setConverter)
      .catch(() => setConverter({ installed: false, path: null, canAutoInstall: false }));
  }, []);

  useEffect(() => {
    setSmartReadCalibration(loadSmartReadCalibration(accountEmail));
  }, [accountEmail]);

  useEffect(() => {
    setApiBase(sync.apiBase ?? "");
  }, [sync.apiBase]);

  const updateSmartReadCalibration = (next: Partial<SmartReadCalibration>) => {
    setSmartReadCalibration((current) => {
      const normalized = normalizeSmartReadCalibration({ ...current, ...next });
      saveSmartReadCalibration(accountEmail, normalized);
      return normalized;
    });
  };

  const syncHelper =
    syncStatus === "syncing"
      ? "Backing up now…"
      : syncStatus === "error"
        ? syncError ?? "Last backup failed. Try again."
        : sync.lastSyncedAt
          ? `Last backed up ${new Date(sync.lastSyncedAt).toLocaleString()}.`
          : "Nothing backed up yet.";

  const syncing = syncStatus === "syncing";
  const syncConfigured = sync.driveConnected || Boolean(sync.folderPath);
  // A folder someone already set up keeps its controls, so turning the feature
  // off can never strand a transport that is still running.
  const showFolderSync = FEATURES.multiDeviceSync || Boolean(sync.folderPath);
  // Readers of a release build sign in with the client it ships. Pasting one's
  // own is a developer affordance, offered only when the build has none.
  const showClientSetup = sync.driveCredentialSource !== "built-in";

  const handleChooseFolder = async () => {
    try {
      const picked = await pickSyncFolder();
      if (!picked) {
        return;
      }
      await setSyncFolder(picked);
      showToast("Folder sync is on.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not use that folder.");
    }
  };

  const handleClearFolder = () => {
    setSyncFolder(null)
      .then(() => showToast("Folder sync stopped. Nothing was deleted."))
      .catch(() => showToast("Could not stop folder sync."));
  };

  const handleSaveCredentials = () => {
    if (credentialBusy) {
      return;
    }
    setCredentialBusy(true);
    setDriveCredentials(clientId, clientSecret)
      .then(() => {
        // Only the id is worth keeping on screen; the secret has been stored.
        setClientSecret("");
        setShowDriveSetup(false);
        showToast("Google client saved. You can connect Drive now.");
      })
      .catch((error) =>
        showToast(error instanceof Error ? error.message : "Could not save those credentials.")
      )
      .finally(() => setCredentialBusy(false));
  };

  const handleClearCredentials = () => {
    clearDriveCredentials()
      .then(() => {
        setClientId("");
        setClientSecret("");
        showToast("Google client removed. Drive is disconnected.");
      })
      .catch(() => showToast("Could not remove those credentials."));
  };

  const handleSaveApiBase = () => {
    setApiBusy(true);
    setCloudApi(apiBase.trim())
      .then(() =>
        showToast(
          apiBase.trim()
            ? "Connected to your Leaflet server."
            : "Leaderboards and shared shelves are off. Sync is unaffected."
        )
      )
      .catch((error) =>
        showToast(error instanceof Error ? error.message : "Could not use that address.")
      )
      .finally(() => setApiBusy(false));
  };

  const handleDisconnectDrive = () => {
    disconnectDrive()
      .then(() => showToast("Drive disconnected. Your books stay on this device, and your backup stays in Drive."))
      .catch(() => showToast("Could not disconnect Drive."));
  };

  const handleDriveAuth = () => {
    showToast("Finish signing in to Google in your browser.");
    startDriveAuth().catch((error) => {
      if (error instanceof Error && error.message.trim().length > 0) {
        showToast(error.message);
        return;
      }
      showToast("Drive connection failed. Please retry.");
    });
  };

  const handleSync = () => {
    syncNow()
      .then(() => {
        const beat = pickBeat("backup", Date.now());
        usePipStore.getState().react(beat.move, { loops: 1, line: beat.line });
      })
      .catch((error) => {
      if (error instanceof Error && error.message.trim().length > 0) {
        showToast(error.message);
        return;
      }
      showToast("Backup failed. Check your Drive connection.");
    });
  };

  const handleConverterToggle = () => {
    if (converter.installed || converterBusy || !converter.canAutoInstall) {
      return;
    }
    setConverterBusy(true);
    converterService
      .install()
      .then(() => converterService.status())
      .then((info) => {
        setConverter(info);
        showToast("Converter ready. Every supported format can now be opened.");
      })
      .catch((error) => {
        if (error instanceof Error && error.message.trim().length > 0) {
          showToast(error.message);
        } else {
          showToast("Converter install failed. Please retry.");
        }
      })
      .finally(() => {
        setConverterBusy(false);
      });
  };

  const handleDeleteAll = () => {
    if (deleteBusy) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      showToast("Click confirm to delete all data.");
      return;
    }
    setDeleteBusy(true);
    bookService
      .clearAllData()
      .then(() => {
        resetLibrary();
        resetHabits();
        resetAppearance();
        // Sync state lives in the backend, which the delete just cleared; re-read
        // it rather than assuming what it now says.
        void loadSyncStatus();
        clearSmartReadProfiles();
        showToast("All data removed.");
      })
      .catch((error) => {
        if (error instanceof Error && error.message.trim().length > 0) {
          showToast(error.message);
        } else {
          showToast("Delete failed. Please retry.");
        }
      })
      .finally(() => {
        setDeleteBusy(false);
        setConfirmDelete(false);
      });
  };

  /** Turning full screen off mid-session wilts the flower it is growing: asked first. */
  const toggleFullScreen = async () => {
    const session = useHabitStore.getState().activeSession;
    if (focusSettings.kioskMode && session?.flower && flowerGrowing(session)) {
      const confirmed = await askConfirm({
        title: "Leave full screen?",
        body: `Your ${session.flower.kind} wilts if full screen goes off mid-session. The session carries on and still counts.`,
        confirmLabel: "Leave full screen",
        cancelLabel: "Stay",
        danger: true,
        pip: "sob"
      });
      if (!confirmed) {
        return;
      }
    }
    setFocusSettings({ kioskMode: !useHabitStore.getState().focusSettings.kioskMode });
  };

  const renderToggle = (on: boolean) => (
    <span
      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
        on ? "bg-primary/30 border-primary/40" : "bg-surface-container-high border-outline-variant/30"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </span>
  );

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div>
        <h2 className="page-title text-4xl">Settings</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Appearance, Pip, backup, your reading goal and your account.
        </p>
      </div>

      {/* Grid items default to `min-width: auto`, so a `truncate` inside one
          (which sets `white-space: nowrap`) makes the whole track as wide as
          that unbroken sentence — on a phone that pushed every card past the
          right edge. `min-w-0` lets the track shrink and the ellipsis work. */}
      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <section className="paper-surface rounded-xl p-5 lg:col-span-2">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Appearance</p>
          <h3 className="page-title mt-2 text-2xl text-on-surface">Choose your reading room</h3>
          <p className="mt-1 text-xs text-on-surface-variant">
            Your choice applies to the library and the reader, and is remembered on this device.
          </p>
          <div className="mt-4 flex gap-4">
            {(["light", "dark"] as ThemeMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`theme-choice ${
                  mode === "light"
                    ? "bg-[#eee5d3] text-[#302a21]"
                    : "bg-[#1b1a17] text-[#eee6d8]"
                }`}
                aria-pressed={theme === mode}
                onClick={() => setTheme(mode)}
              >
                <UiIcon name={mode === "light" ? "sun" : "moon"} size={23} />
                <span className="text-sm font-semibold capitalize">{mode} mode</span>
              </button>
            ))}
          </div>
          <div className="section-rule mt-5 flex flex-wrap items-center justify-between gap-3 pt-4">
            <span className="text-xs text-on-surface-variant">
              {followSystem ? "Following the Windows appearance setting." : "Leaflet opens in the mode you pick here. Light is the default."}
            </span>
            <button
              type="button"
              className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
              onClick={followSystemTheme}
              disabled={followSystem}
            >
              Use Windows Theme
            </button>
          </div>
        </section>

        <section className="paper-surface rounded-xl p-5 lg:col-span-2">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Pip</p>
          <div className="mt-2 flex flex-wrap items-center gap-5">
            <div className="min-w-0 flex-1">
              <h3 className="page-title text-2xl text-on-surface">Your reading companion</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{pipChoice.detail}</p>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="How much Pip moves">
                {PIP_MODES.map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    className={`tactile-button px-4 py-2 text-xs ${pipMode === item.mode ? "tactile-button-primary" : ""}`}
                    aria-pressed={pipMode === item.mode}
                    onClick={() => setPipMode(item.mode)}
                  >
                    {item.label}
                  </button>
                ))}
                {pipMode !== "off" && (
                  <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={startPipTour}>
                    Show Me Around
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="paper-surface rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Backup</p>
          <p className="mt-3 font-headline text-2xl font-bold text-on-surface">
            {sync.driveConnected
              ? sync.accountEmail ?? "Google Drive"
              : sync.folderPath
                ? "Sync folder"
                : "Not backed up"}
          </p>
          <p className="mt-2 text-xs text-on-surface-variant">{syncHelper}</p>
          {sync.booksPending > 0 && (
            <p className="mt-1 text-xs text-on-surface-variant">
              {sync.booksPending} {sync.booksPending === 1 ? "book" : "books"} in your library
              will download the first time you open them.
            </p>
          )}

          {showFolderSync && (
          <div className="mt-5 border-t border-outline-variant/40 pt-4">
            <p className="text-xs font-semibold text-on-surface">Sync folder</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Point Leaflet at a folder your Google Drive, Dropbox, OneDrive or iCloud app
              already keeps in step. No account, no setup.
            </p>
            {sync.folderPath && (
              <p className="mt-2 break-all text-xs text-on-surface-variant">{sync.folderPath}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="tactile-button px-4 py-2 text-xs"
                onClick={() => void handleChooseFolder()}
              >
                {sync.folderPath ? "Change Folder" : "Choose Folder"}
              </button>
              {sync.folderPath && (
                <button
                  type="button"
                  className="tactile-button px-4 py-2 text-xs"
                  onClick={handleClearFolder}
                >
                  Stop Folder Sync
                </button>
              )}
            </div>
          </div>
          )}

          <div className="mt-5 border-t border-outline-variant/40 pt-4">
            <p className="text-xs font-semibold text-on-surface">Google Drive</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              {sync.driveAvailable
                ? "Your books, reading progress and streak are copied to a Leaflet folder in your own Drive. Connect the same account on a new computer to restore them. Leaflet only ever sees the files it creates."
                : "This build has no Google client, so Drive backup is unavailable. Set one up below to enable it."}
            </p>

            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleDriveAuth}
                disabled={!sync.driveAvailable}
              >
                {sync.driveConnected ? "Reconnect Drive" : "Connect Drive"}
              </button>
              {sync.driveConnected && (
                <button
                  type="button"
                  className="tactile-button px-4 py-2 text-xs"
                  onClick={handleDisconnectDrive}
                >
                  Disconnect
                </button>
              )}
              {showClientSetup && (
                <button
                  type="button"
                  className="tactile-button px-4 py-2 text-xs"
                  onClick={() => setShowDriveSetup((open) => !open)}
                >
                  {showDriveSetup ? "Hide Setup" : sync.driveAvailable ? "Change Client" : "Set Up Drive"}
                </button>
              )}
            </div>

            {sync.driveCredentialSource === "custom" && !showDriveSetup && (
              <p className="mt-2 text-[11px] text-on-surface-variant">
                Using a Google client you provided.{" "}
                <button
                  type="button"
                  className="underline decoration-dotted underline-offset-2"
                  onClick={handleClearCredentials}
                >
                  Remove it
                </button>
              </p>
            )}

            {showClientSetup && showDriveSetup && (
              <div className="mt-3 rounded-lg border border-outline-variant/40 p-3">
                <p className="text-[11px] leading-relaxed text-on-surface-variant">
                  In the Google Cloud console, create an OAuth client of type{" "}
                  <span className="font-semibold text-on-surface">Desktop app</span>, then paste
                  it below. Leaflet requests only the <code>drive.file</code> scope, which lets it
                  see the files it creates and nothing else in your Drive.
                </p>
                <label className="mt-3 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                  Client ID
                </label>
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="…apps.googleusercontent.com"
                  spellCheck={false}
                  autoComplete="off"
                  className="inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface"
                />
                <label className="mt-3 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                  Client secret
                </label>
                <input
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder="Optional for desktop clients"
                  spellCheck={false}
                  autoComplete="off"
                  className="inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-on-surface-variant">
                  Google treats desktop clients as public, so this secret is not confidential —
                  the sign-in is protected by PKCE either way.
                </p>
                <button
                  type="button"
                  className="tactile-button tactile-button-primary mt-3 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleSaveCredentials}
                  disabled={credentialBusy || clientId.trim().length === 0}
                >
                  {credentialBusy ? "Saving…" : "Save Client"}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="tactile-button tactile-button-primary mt-5 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSync}
            disabled={!syncConfigured || syncing}
          >
            {syncing ? "Backing up…" : "Back Up Now"}
          </button>
          {!FEATURES.multiDeviceSync && (
            <p className="mt-3 text-[11px] leading-relaxed text-on-surface-variant">
              Reading across your phone and computer arrives with the Leaflet mobile app — coming
              soon.
            </p>
          )}
        </div>

        {/* Keyed on the server, so switching servers re-reads who is signed in. */}
        {FEATURES.accounts && sync.apiBase && (
          <AccountCard key={sync.apiBase} showToast={showToast} />
        )}

        {FEATURES.community && (
        <div className="paper-surface rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">
            Leaderboards &amp; Shared Shelves
          </p>
          <p className="mt-3 font-headline text-2xl font-bold text-on-surface">
            {sync.apiBase ? "Connected" : "Off"}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            The only part of Leaflet with a server. It carries your reading stats — never your
            book files — so a weekly leaderboard and a shareable shelf are possible. Sync works
            without it, and your profile stays private until you choose otherwise.
          </p>
          <label className="mt-4 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            Server address
          </label>
          <input
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder="https://your-leaflet-server.example"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleSaveApiBase}
              disabled={apiBusy}
            >
              {apiBusy ? "Saving…" : "Save"}
            </button>
            {sync.apiBase && (
              <button
                type="button"
                className="tactile-button px-4 py-2 text-xs"
                onClick={() => {
                  setApiBase("");
                  setCloudApi("")
                    .then(() => showToast("Disconnected."))
                    .catch(() => showToast("Could not disconnect from that server."));
                }}
              >
                Disconnect
              </button>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-on-surface-variant">
            Run your own with <code>server/</code> in the repo. Sharing a profile needs a
            Leaflet account on that server.
          </p>
        </div>
        )}

        <div className="paper-surface rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">
            Smart Read Calibration
          </p>
          <h3 className="page-title mt-2 text-2xl text-on-surface">Your comfortable pace</h3>
          <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            Dotty learns inside this range. A wider range lets it react more strongly when you read
            faster or slow down for difficult material.
          </p>
          <div className="mt-5 space-y-5">
            <label className="block">
              <span className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
                <span>Minimum pace</span>
                <strong className="text-on-surface">{smartReadCalibration.minWpm} WPM</strong>
              </span>
              <input
                className="mt-3 w-full accent-primary"
                type="range"
                min={70}
                max={Math.max(70, smartReadCalibration.maxWpm - 20)}
                step={5}
                value={smartReadCalibration.minWpm}
                onChange={(event) =>
                  updateSmartReadCalibration({ minWpm: Number(event.target.value) })
                }
              />
            </label>
            <label className="block">
              <span className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
                <span>Maximum pace</span>
                <strong className="text-on-surface">{smartReadCalibration.maxWpm} WPM</strong>
              </span>
              <input
                className="mt-3 w-full accent-primary"
                type="range"
                min={Math.min(500, smartReadCalibration.minWpm + 20)}
                max={500}
                step={5}
                value={smartReadCalibration.maxWpm}
                onChange={(event) =>
                  updateSmartReadCalibration({ maxWpm: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <div className="section-rule mt-5 flex items-center justify-between gap-3 pt-4 text-xs text-on-surface-variant">
            <span>Adaptive range</span>
            <span className="font-semibold text-on-surface">
              {smartReadCalibration.minWpm}–{smartReadCalibration.maxWpm} WPM
            </span>
          </div>
        </div>

        <div className="paper-surface rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Optional Book Converter</p>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">
            <span className="text-on-surface">{dependencyFreeSummary()}</span> open with no
            converter at all — Leaflet reads them itself.{" "}
            {converterSupported ? (
              <>
                The remaining {externalConverterCount()} formats, including Kindle and Word files,
                are converted by Calibre, which Leaflet never bundles: an existing Calibre on this
                computer is used automatically, and otherwise Leaflet asks before downloading
                anything.
              </>
            ) : (
              <>
                The remaining {externalConverterCount()} formats need Calibre, which has no version
                for this device. Open one on a desktop once and the converted book syncs here like
                any other.
              </>
            )}
          </p>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                {converter.installed
                  ? "Ready"
                  : converterSupported
                    ? "Not installed"
                    : "Desktop only"}
              </p>
              <p className="truncate text-xs text-on-surface-variant" title={converter.path ?? undefined}>
                {converterBusy
                  ? "Downloading and installing..."
                  : converter.installed
                    ? `Using ${converter.path ?? "the installed converter"}`
                    : !converterSupported
                      ? "Not available on this device."
                      : converter.canAutoInstall
                        ? "About 200 MB. The installer is removed after setup."
                        : "Install Calibre from calibre-ebook.com and Leaflet will detect it."}
              </p>
            </div>
            {!converter.installed && converter.canAutoInstall && (
              <button
                type="button"
                className="tactile-button shrink-0 px-4 py-2 text-xs font-semibold disabled:cursor-default disabled:opacity-70"
                onClick={handleConverterToggle}
                disabled={converterBusy}
              >
                {converterBusy ? "Installing" : "Download now"}
              </button>
            )}
          </div>
        </div>

        <div className="paper-surface rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Focus Mode</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            Read this much in a day to keep your streak alive. Time counts whenever a book is
            open, whether or not a focus session is running.
          </p>
          <div className="mt-4 space-y-3">
            <div className="inset-field flex w-full items-center justify-between gap-4 px-4 py-3">
              <span className="text-xs text-on-surface-variant">Daily reading goal</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="tactile-button h-8 w-8 text-sm"
                  onClick={() => void setGoalMinutes(Math.max(5, goalMinutes - 5))}
                  aria-label="Decrease daily goal"
                >
                  -
                </button>
                <span className="min-w-20 text-center text-sm font-semibold text-on-surface tabular-nums">
                  {goalMinutes} min
                </span>
                <button
                  type="button"
                  className="tactile-button h-8 w-8 text-sm"
                  onClick={() => void setGoalMinutes(Math.min(240, goalMinutes + 5))}
                  aria-label="Increase daily goal"
                >
                  +
                </button>
              </div>
            </div>
            <button
              type="button"
              className="inset-field flex w-full items-center justify-between px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ goalBinding: !focusSettings.goalBinding })}
            >
              <span>Auto-start focus when opening a book</span>
              {renderToggle(focusSettings.goalBinding)}
            </button>
            <button
              type="button"
              className="inset-field flex w-full items-center justify-between px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => void toggleFullScreen()}
            >
              <span className="text-left">
                <span className="block">Full screen (focus lock)</span>
                <span className="mt-0.5 block text-[11px] opacity-75">
                  Sessions run full screen and grow a focus flower, which blooms if you stay to the end. Pip guards
                  the way out; hold Esc to leave.
                </span>
              </span>
              {renderToggle(focusSettings.kioskMode)}
            </button>
            <button
              type="button"
              className="inset-field flex w-full items-center justify-between px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ checkpointPrompts: !focusSettings.checkpointPrompts })}
            >
              <span>Checkpoint prompts at 50/90/100%</span>
              {renderToggle(focusSettings.checkpointPrompts)}
            </button>
            <button
              type="button"
              className="inset-field flex w-full items-center justify-between px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ sessionNotes: !focusSettings.sessionNotes })}
            >
              <span>Prompt for session notes on finish</span>
              {renderToggle(focusSettings.sessionNotes)}
            </button>
          </div>
        </div>

        <RemindersCard showToast={showToast} />

        <div className="paper-surface rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Danger Zone</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            This clears your local library, covers, sessions, and settings.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="tactile-button border-error/50 bg-error/10 px-4 py-2 text-xs text-error hover:bg-error/20"
              onClick={handleDeleteAll}
              disabled={deleteBusy}
            >
              {confirmDelete ? "Confirm Delete" : "Delete All Data"}
            </button>
            {confirmDelete && !deleteBusy && (
              <button
                type="button"
                className="tactile-button px-4 py-2 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <section className="paper-surface rounded-xl p-5 lg:col-span-2" aria-labelledby="about-title">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">About</p>
          <div className="mt-2 flex flex-wrap items-center gap-5">
            <div className="min-w-0 flex-1">
              <h3 id="about-title" className="page-title text-2xl text-on-surface">
                Enjoying Leaflet?
              </h3>
              <p className="mt-1 text-xs text-on-surface-variant">
                A rating on the Microsoft Store helps other readers find it. Questions, bugs or ideas:{" "}
                <span className="selectable font-semibold text-on-surface">{SUPPORT_EMAIL}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="tactile-button tactile-button-primary px-4 py-2 text-xs"
                  onClick={() => void openStoreReview()}
                >
                  Rate Leaflet ★
                </button>
                {PRIVACY_URL && (
                  <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => void accountService.openLink(PRIVACY_URL)}>
                    Privacy policy
                  </button>
                )}
                {TERMS_URL && (
                  <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => void accountService.openLink(TERMS_URL)}>
                    Terms of use
                  </button>
                )}
                <button
                  type="button"
                  className="tactile-button px-4 py-2 text-xs"
                  title="Copies versions, settings and the recent log (no passwords or book contents) to paste into an email"
                  onClick={() =>
                    void diagnosticsService
                      .report()
                      .then((report) => navigator.clipboard.writeText(report))
                      .then(() => showToast(`Diagnostics copied. Paste them into an email to ${SUPPORT_EMAIL}.`))
                      .catch(() => showToast("Couldn't copy diagnostics."))
                  }
                >
                  Copy diagnostics
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

/**
 * Optional Leaflet account: sign up, sign in, and managing it once signed in.
 *
 * Only rendered when the build enables accounts and a server is configured.
 * Everything in the app works without one; an account only unlocks the
 * leaderboard and shared shelves.
 */
const AccountCard = ({ showToast }: { showToast: (message: string) => void }) => {
  const status = useAccountStore((state) => state.status);
  const loaded = useAccountStore((state) => state.loaded);
  const load = useAccountStore((state) => state.load);
  const signOut = useAccountStore((state) => state.signOut);
  const changePassword = useAccountStore((state) => state.changePassword);
  const deleteAccount = useAccountStore((state) => state.deleteAccount);

  const [panel, setPanel] = useState<"none" | "password" | "delete">("none");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load(true);
  }, [load]);

  const reset = () => {
    setCurrent("");
    setNext("");
    setError(null);
  };

  const attempt = (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        reset();
        setPanel("none");
        showToast(done);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const open = (which: "password" | "delete" | "none") => {
    reset();
    setPanel(which);
  };

  const fieldClass = "inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface";
  const labelClass = "mt-3 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant";
  const account = status.account;

  if (!loaded) {
    return null;
  }

  const errorBox = error && (
    <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>
  );

  if (status.signedIn) {
    return (
      <div className="paper-surface rounded-xl p-5">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">Account</p>
        <div className="mt-3 flex items-center gap-3">
          {account?.avatar && <PipAvatar seed={null} avatar={account.avatar} size={48} play="idle" label="Your Pip" />}
          <div className="min-w-0">
            <p className="truncate font-headline text-2xl font-bold text-on-surface">{account?.email || "Signed in"}</p>
            {FEATURES.community && (
              <p className="mt-1 text-xs text-on-surface-variant">Your name, handle and Pip are on Social → Community.</p>
            )}
          </div>
        </div>
        {status.offline && (
          <p className="mt-2 text-[11px] text-on-surface-variant">Offline. Showing saved details.</p>
        )}

        {panel === "password" && (
          <div className="mt-1">
            <label className={labelClass}>Current password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className={fieldClass}
            />
            <label className={labelClass}>New password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              className={fieldClass}
            />
            <p className="mt-1 text-[10px] text-on-surface-variant">
              At least 8 characters. Your other devices will be signed out.
            </p>
          </div>
        )}

        {panel === "delete" && (
          <div className="mt-3">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              This deletes your account, profile and synced data from the server. Books and reading
              history on this device stay.
            </p>
            <label className={labelClass}>Password to confirm</label>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className={fieldClass}
            />
          </div>
        )}

        {errorBox}

        <div className="mt-4 flex flex-wrap gap-3">
          {panel === "none" && (
            <>
              <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => open("password")}>
                Change password
              </button>
              <button
                type="button"
                className="tactile-button px-4 py-2 text-xs disabled:opacity-60"
                disabled={busy}
                onClick={() => attempt(signOut, "Signed out.")}
              >
                Sign out
              </button>
              <button
                type="button"
                className="tactile-button border-error/50 bg-error/10 px-4 py-2 text-xs text-error hover:bg-error/20"
                onClick={() => open("delete")}
              >
                Delete account
              </button>
            </>
          )}
          {panel === "password" && (
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !current || next.length < 8}
              onClick={() => attempt(() => changePassword(current, next), "Password changed.")}
            >
              {busy ? "Saving…" : "Save password"}
            </button>
          )}
          {panel === "delete" && (
            <button
              type="button"
              className="tactile-button border-error/50 bg-error/10 px-4 py-2 text-xs text-error hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !current}
              onClick={() => attempt(() => deleteAccount(current), "Account deleted.")}
            >
              {busy ? "Deleting…" : "Delete for good"}
            </button>
          )}
          {panel !== "none" && (
            <button type="button" className="tactile-button px-4 py-2 text-xs" disabled={busy} onClick={() => open("none")}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Account</p>
      <div className="mt-3">
        <AccountForm onDone={showToast} />
      </div>
    </div>
  );
};
