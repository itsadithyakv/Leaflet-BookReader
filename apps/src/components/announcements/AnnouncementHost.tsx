import { Suspense, lazy, useEffect, useState } from "react";
import type { Announcement, AnnouncementAction } from "../../services/adminService";
import { driveUsed, forThisDevice, markSeen, noteDriveUsed, type Button, type Device } from "../../services/announcements";
import { accountService } from "../../services/accountService";
import { updateService } from "../../services/updateService";
import { useBackClose } from "../../hooks/useBackClose";
import { isAndroid } from "../../platform/device";
import { useAdminPage } from "../admin/AdminHost";
import { AnnouncementCard } from "./AnnouncementCard";

const ReportProblemSheet = lazy(() => import("../ReportProblemSheet").then((module) => ({ default: module.ReportProblemSheet })));

/** Asked this long after Leaflet opens (after the update card's ask, so the two share one answer), then this often. */
const FIRST_ASK_MS = 25_000;
const ASK_EVERY_MS = 6 * 60 * 60_000;

type Props = {
  /** The Library is showing and no book is open: the only time one is shown. */
  ready: boolean;
  /** Google Drive is connected here now (remembered, for announcements to Drive's readers). */
  driveConnected: boolean;
  /** The actions the app carries out itself: reconnecting Drive, opening Settings on Library. */
  onAction: (action: Exclude<AnnouncementAction, "report_problem">) => void;
  showToast: (message: string) => void;
};

const platform = (): Device["platform"] => {
  if (isAndroid()) return "android";
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac OS X|Macintosh/i.test(agent)) return "macos";
  return "linux";
};

/**
 * The owner's announcements, each shown once on this device: a while after
 * Leaflet opens, only in the Library and never over an open book (one that
 * arrives meanwhile waits for the reader to come back), one at a time, the
 * oldest first. "OK", the cross or its button puts it away for good; Back
 * hides it for now. Signed in or not.
 */
export const AnnouncementHost = ({ ready, driveConnected, onAction, showToast }: Props) => {
  const [waiting, setWaiting] = useState<Announcement[]>([]);
  const [hidden, setHidden] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (driveConnected) noteDriveUsed();
  }, [driveConnected]);

  useEffect(() => {
    let live = true;
    const ask = async () => {
      const [notice, version] = await Promise.all([updateService.notice(), updateService.mine()]);
      if (!live || !notice) return;
      const device: Device = { platform: platform(), version, driveUsed: driveUsed() };
      setWaiting(forThisDevice(notice.announcements, device));
    };
    const first = window.setTimeout(() => void ask(), FIRST_ASK_MS);
    const again = window.setInterval(() => void ask(), ASK_EVERY_MS);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  const adminOpen = useAdminPage((state) => state.open);
  const current = ready && !hidden && !adminOpen ? waiting[0] : undefined;
  useBackClose(Boolean(current), () => setHidden(true));

  const putAway = (item: Announcement) => {
    markSeen(item.id);
    setWaiting((list) => list.filter((entry) => entry.id !== item.id));
  };

  const press = (item: Announcement, button: Button) => {
    putAway(item);
    if ("url" in button) {
      void accountService.openLink(button.url).catch(() => showToast("Couldn't open the link."));
    } else if (button.action === "report_problem") {
      setReporting(true);
    } else {
      onAction(button.action);
    }
  };

  return (
    <>
      {current && <AnnouncementCard item={current} onDismiss={() => putAway(current)} onButton={(button) => press(current, button)} />}
      {reporting && (
        <Suspense fallback={null}>
          <ReportProblemSheet open onClose={() => setReporting(false)} showToast={showToast} />
        </Suspense>
      )}
    </>
  );
};
