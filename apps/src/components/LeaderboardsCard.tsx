import { useCallback, useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "../services/accountService";
import { socialService } from "../services/socialService";
import { useLibraryStore } from "../store/libraryStore";

type Reach = { state: "checking" } | { state: "ok" } | { state: "down"; reason: string };

/**
 * Settings → Leaderboards & shared shelves.
 *
 * A reader sees whether it is working and what it is for. Where the server is
 * is not their concern: the app finds it itself (a signed config, see
 * `sync/remote_config.rs`). The address, and running a server of one's own,
 * are kept for the people who want them, under Advanced.
 */
export const LeaderboardsCard = ({ showToast }: { showToast: (message: string) => void }) => {
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const custom = useLibraryStore((state) => state.sync.apiBaseCustom);
  const setCloudApi = useLibraryStore((state) => state.setCloudApi);
  const [reach, setReach] = useState<Reach>({ state: "checking" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const advancedId = useId();
  /** The newest check asked for. An older one still on its way is not the answer. */
  const asked = useRef(0);

  // Only an address typed in here is shown back. Leaflet's own is not the
  // reader's to maintain, so the field stays empty for it.
  useEffect(() => {
    setAddress(custom ? apiBase ?? "" : "");
  }, [apiBase, custom]);

  const check = useCallback(() => {
    if (!apiBase) {
      return;
    }
    // A check of the last address can take ten seconds to give up, and used
    // to land after the new address had answered: "Can't reach it", about a
    // server that was connected. Only the newest check is listened to.
    const mine = (asked.current += 1);
    setReach({ state: "checking" });
    socialService
      .checkServer()
      .then(() => mine === asked.current && setReach({ state: "ok" }))
      .catch(
        (cause) =>
          mine === asked.current &&
          setReach({ state: "down", reason: errorMessage(cause, "Could not reach the Leaflet server.") })
      );
  }, [apiBase]);

  useEffect(check, [check]);

  const save = (value: string) => {
    setSaving(true);
    setCloudApi(value.trim())
      .then(() => {
        const now = useLibraryStore.getState().sync;
        showToast(
          !now.apiBase
            ? "Leaderboards and shared shelves are off. Backup is unaffected."
            : now.apiBaseCustom
              ? "Connected to your Leaflet server."
              : "Using Leaflet's own server."
        );
      })
      .catch((cause) => showToast(errorMessage(cause, "Could not use that address.")))
      .finally(() => setSaving(false));
  };

  const title = !apiBase
    ? "Off"
    : reach.state === "ok"
      ? "Connected"
      : reach.state === "down"
        ? "Can't reach it"
        : "Checking…";

  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Leaderboards &amp; Shared Shelves</p>
      <p className="mt-3 font-headline text-2xl font-bold text-on-surface" role="status">
        {title}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
        A weekly leaderboard, and a shelf you can share. Only your reading stats are sent, never your books.
        A new account's profile is shared with other readers unless you switch that off when you create it,
        and you can make it private at any time under Social. Reading and backup work without it.
      </p>

      {apiBase && reach.state === "down" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-on-surface-variant">
            {reach.reason} School and work Wi-Fi sometimes block it; it works again on another network.
          </p>
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={check}>
            Try Again
          </button>
        </div>
      )}
      {!apiBase && (
        <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
          Leaflet hasn't found its server yet. It looks again each time it starts.
        </p>
      )}

      <div className="section-rule mt-4 pt-3">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md py-1 text-xs text-on-surface-variant transition hover:text-primary"
          aria-expanded={advancedOpen}
          aria-controls={advancedId}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`}
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Advanced
        </button>
        <div id={advancedId} hidden={!advancedOpen}>
          <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
            Leaflet finds its own server by itself, so most readers never need this. If you run your own (the{" "}
            <code>server/</code> folder of Leaflet's source code), enter its address. Sharing a profile needs a
            Leaflet account on that server.
          </p>
          <label
            htmlFor={`${advancedId}-address`}
            className="mt-3 block text-[10px] uppercase tracking-[0.2em] text-on-surface-variant"
          >
            Server address
          </label>
          <input
            id={`${advancedId}-address`}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={custom || !apiBase ? "https://your-leaflet-server.example" : "Using Leaflet's own server"}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="inset-field mt-1 w-full px-3 py-2 text-xs text-on-surface"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => save(address)}
              disabled={saving || address.trim().length === 0}
            >
              {saving ? "Saving…" : "Use This Server"}
            </button>
            {custom && (
              <button
                type="button"
                className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => save("")}
                disabled={saving}
              >
                Go Back to Leaflet's Server
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
