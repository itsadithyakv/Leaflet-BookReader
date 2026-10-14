import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { isNewer, updateService, type UpdateNotice } from "../services/updateService";

/** Asked this long after Leaflet opens (not at once: the first seconds are the library's), and then this often. */
const FIRST_ASK_MS = 20_000;
const ASK_EVERY_MS = 6 * 60 * 60_000;
/** The version whose notice was put away ("Later"): it is not offered again; a newer one is. */
const DISMISSED_KEY = "leaflet.update.dismissed";

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
};

/**
 * A small card in a corner when the owner has said a newer Leaflet is out
 * than this one (`updateService`): the version, the owner's line about it,
 * Update (the Store's page for Leaflet) and Later. Later puts that version
 * away for good; the next one is offered again. Nothing is asked of a reader
 * who is up to date, and nothing shows in the browser preview.
 */
export const UpdateBanner = () => {
  const [offer, setOffer] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    let live = true;
    const ask = async () => {
      const [notice, mine] = await Promise.all([updateService.notice(), updateService.mine()]);
      if (!live || !notice?.version || !mine) return;
      if (isNewer(notice.version, mine) && dismissed() !== notice.version) setOffer(notice);
    };
    const first = window.setTimeout(() => void ask(), FIRST_ASK_MS);
    const again = window.setInterval(() => void ask(), ASK_EVERY_MS);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  if (!offer?.version) return null;
  const later = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, offer.version ?? "");
    } catch {
      // Put away for this visit only.
    }
    setOffer(null);
  };

  return (
    <div role="status" className="modal-surface fixed bottom-24 right-5 z-[70] flex w-[min(22rem,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl p-4 shadow-lg">
      <Sparkles size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-on-surface">Leaflet {offer.version} is out</p>
        {offer.note && <p className="mt-1 text-xs leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">{offer.note}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="tactile-button tactile-button-primary px-3 py-1.5 text-xs"
            onClick={() => {
              void updateService.openStore();
              setOffer(null);
            }}
          >
            Update
          </button>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={later}>
            Later
          </button>
        </div>
      </div>
      <button type="button" className="shrink-0 rounded-full p-1 text-on-surface-variant hover:text-on-surface" aria-label="Put away" onClick={later}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
};
