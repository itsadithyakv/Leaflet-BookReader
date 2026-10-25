import { useEffect, useState, type ReactNode } from "react";
import { syncService } from "../../services/syncService";
import { formatBytes } from "../../services/storageService";
import { InfoTip } from "../ui/InfoTip";

const HINT = "Pictures in the copy sent to Drive are made smaller. The book on this device is never changed.";

/** The (i)'s words, with what smaller copies have saved so far once there is something to say. */
export const smallerBackupsHint = (savedBytes: number): string =>
  savedBytes >= 1024 * 1024 ? `${HINT} Saved so far: ${formatBytes(savedBytes)}.` : HINT;

/**
 * "Smaller backups", under Google Drive in Settings: on by default, this
 * device's own. Off sends originals from now on; what Drive holds stays.
 */
export const SmallerBackupsSwitch = ({ renderToggle }: { renderToggle: (on: boolean) => ReactNode }) => {
  const [on, setOn] = useState(true);
  const [savedBytes, setSavedBytes] = useState(0);

  useEffect(() => {
    let live = true;
    syncService
      .smallerBackups()
      .then((state) => {
        if (live) {
          setOn(state.on);
          setSavedBytes(state.savedBytes);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const flip = () => {
    const next = !on;
    setOn(next);
    syncService
      .setSmallerBackups(next)
      .then((state) => {
        setOn(state.on);
        setSavedBytes(state.savedBytes);
      })
      .catch(() => setOn(!next));
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="inset-field flex flex-1 items-center justify-between gap-3 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
        onClick={flip}
      >
        <span className="text-left">Smaller backups</span>
        {renderToggle(on)}
      </button>
      <InfoTip text={smallerBackupsHint(savedBytes)} />
    </div>
  );
};
