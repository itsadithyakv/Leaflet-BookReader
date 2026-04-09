import { useEffect, useMemo, useState } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useHabitStore } from "../store/habitStore";
import { useAccountStore } from "../store/accountStore";
import { converterService } from "../services/converterService";
import { bookService } from "../services/bookService";

export type SettingsPageProps = {
  showToast: (message: string) => void;
};

export const SettingsPage = ({ showToast }: SettingsPageProps) => {
  const { driveConnected, syncStatus, startDriveAuth, syncNow, filters, setFilter, resetAll: resetLibrary } =
    useLibraryStore();
  const { focusSettings, setFocusSettings, resetAll: resetHabits } = useHabitStore();
  const { resetAll: resetAccount } = useAccountStore();
  const [converterInstalled, setConverterInstalled] = useState(false);
  const [converterBusy, setConverterBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    converterService
      .status()
      .then((installed) => setConverterInstalled(installed))
      .catch(() => setConverterInstalled(false));
  }, []);

  const driveHelper =
    syncStatus === "syncing"
      ? "Syncing now..."
      : syncStatus === "error"
        ? "Last sync failed. Try again."
        : "Ready when you are.";

  const activeFilters = useMemo(() => {
    const items: string[] = [];
    if (filters.query.trim().length > 0) {
      items.push(`Search: "${filters.query.trim()}"`);
    }
    if (filters.author !== "all") {
      items.push(`Author: ${filters.author}`);
    }
    if (filters.genre !== "all") {
      items.push(`Genre: ${filters.genre}`);
    }
    return items;
  }, [filters.author, filters.genre, filters.query]);

  const resetFilters = () => {
    setFilter({ query: "", author: "all", genre: "all", sort: "recent", view: "grid" });
    showToast("Filters reset.");
  };

  const handleDriveAuth = () => {
    startDriveAuth().catch((error) => {
      if (error instanceof Error && error.message.trim().length > 0) {
        showToast(error.message);
        return;
      }
      showToast("Drive connection failed. Please retry.");
    });
  };

  const handleSync = () => {
    syncNow().catch((error) => {
      if (error instanceof Error && error.message.trim().length > 0) {
        showToast(error.message);
        return;
      }
      showToast("Sync failed. Check Drive status.");
    });
  };

  const handleConverterToggle = () => {
    if (converterInstalled || converterBusy) {
      return;
    }
    setConverterBusy(true);
    converterService
      .install()
      .then(() => {
        setConverterInstalled(true);
        showToast("Converter installed. AZW3/MOBI import is ready.");
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
        resetAccount();
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
        <h2 className="text-3xl font-headline font-bold">Settings</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Manage sync and keep your archive tidy.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Drive Sync</p>
          <p className="mt-3 font-headline text-2xl font-bold text-on-surface">
            {driveConnected ? "Connected" : "Not Connected"}
          </p>
          <p className="mt-2 text-xs text-on-surface-variant">{driveHelper}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={handleDriveAuth}
            >
              {driveConnected ? "Reconnect Drive" : "Connect Drive"}
            </button>
            <button
              type="button"
              className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleSync}
              disabled={!driveConnected}
            >
              Sync Now
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Library Filters</p>
          <p className="mt-3 text-sm text-on-surface-variant">
            {activeFilters.length === 0 ? "No filters applied." : activeFilters.join(" | ")}
          </p>
          <button
            type="button"
            className="mt-4 rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
            onClick={resetFilters}
          >
            Reset Filters
          </button>
        </div>

        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Book Converter</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            Install the built-in converter to open AZW3 and MOBI files without extra tools.
          </p>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-on-surface">
                {converterInstalled ? "Installed" : "Not Installed"}
              </p>
              <p className="text-xs text-on-surface-variant">
                {converterBusy ? "Installing now..." : "Installer runs once and stays cached."}
              </p>
            </div>
            <button
              type="button"
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                converterInstalled ? "bg-primary/30 border-primary/40" : "bg-surface-container-high border-outline-variant/30"
              } ${converterBusy ? "opacity-60" : ""}`}
              onClick={handleConverterToggle}
              disabled={converterInstalled || converterBusy}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                  converterInstalled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Focus Mode</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            Configure how Leaflet handles focus sessions.
          </p>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-outline-variant/30 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ goalBinding: !focusSettings.goalBinding })}
            >
              <span>Auto-start focus when opening a book</span>
              {renderToggle(focusSettings.goalBinding)}
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-outline-variant/30 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ kioskMode: !focusSettings.kioskMode })}
            >
              <span>Kiosk mode during focus</span>
              {renderToggle(focusSettings.kioskMode)}
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-outline-variant/30 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ checkpointPrompts: !focusSettings.checkpointPrompts })}
            >
              <span>Checkpoint prompts at 50/90/100%</span>
              {renderToggle(focusSettings.checkpointPrompts)}
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-outline-variant/30 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => setFocusSettings({ sessionNotes: !focusSettings.sessionNotes })}
            >
              <span>Prompt for session notes on finish</span>
              {renderToggle(focusSettings.sessionNotes)}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Danger Zone</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            This clears your local library, covers, sessions, and settings.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200 transition hover:bg-red-500/20"
              onClick={handleDeleteAll}
              disabled={deleteBusy}
            >
              {confirmDelete ? "Confirm Delete" : "Delete All Data"}
            </button>
            {confirmDelete && !deleteBusy && (
              <button
                type="button"
                className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
