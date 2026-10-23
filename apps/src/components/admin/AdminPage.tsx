import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useBackClose } from "../../hooks/useBackClose";
import { useOrientation } from "../../platform/device";
import { AdminPanel, UpdateNoticeCard } from "../discuss/AdminPanel";
import { ProblemsPanel } from "../discuss/ProblemsPanel";
import { SegmentedTabs, panelId, tabId, type SegmentedTab } from "../ui/SegmentedTabs";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { ErrorsPanel } from "./ErrorsPanel";
import { OverviewPanel } from "./OverviewPanel";
import "./admin.css";

export type AdminSection = "overview" | "errors" | "problems" | "moderation" | "announcements" | "notice";

const SECTIONS: SegmentedTab<AdminSection>[] = [
  { id: "overview", label: "Overview" },
  { id: "errors", label: "Errors" },
  { id: "problems", label: "Problems" },
  { id: "moderation", label: "Moderation" },
  { id: "announcements", label: "Announcements" },
  { id: "notice", label: "Update notice" }
];
const SECTION_KEY = "leaflet.admin.section";

const readSection = (): AdminSection => {
  try {
    const kept = sessionStorage.getItem(SECTION_KEY);
    return SECTIONS.some((section) => section.id === kept) ? (kept as AdminSection) : "overview";
  } catch {
    return "overview";
  }
};

/**
 * Everything the owner looks after, in one place: how Leaflet is doing
 * (readers, versions, the server, the database), the errors the apps
 * report by themselves, the problem reports readers send, what was reported
 * in the community, announcements, and the update notice. Over the whole
 * app, opaque, from the profile menu; Back or the cross closes it.
 */
export const AdminPage = ({ onClose, showToast }: { onClose: () => void; showToast: (message: string) => void }) => {
  const [section, setSection] = useState<AdminSection>(readSection);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sideways = useOrientation() === "landscape" && typeof window !== "undefined" && window.innerHeight < 500;
  useBackClose(true, onClose);

  useEffect(() => {
    closeRef.current?.focus();
    // Escape closes the page, unless a sheet or a question is open over it (that one closes first).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      if (open[open.length - 1] === rootRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (next: AdminSection) => {
    try {
      sessionStorage.setItem(SECTION_KEY, next);
    } catch {
      // This visit only.
    }
    setSection(next);
  };

  return (
    <div ref={rootRef} className="admin-page fixed inset-0 z-[90] flex flex-col bg-background text-on-surface" role="dialog" aria-modal="true" aria-labelledby="admin-page-title">
      {/* A phone on its side keeps the bar to a line or two: the page is what is short. */}
      <div className="admin-page-bar flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-outline-variant/30 px-4 py-3 short:py-1.5 md:px-8">
        <h1 id="admin-page-title" className="page-title text-3xl short:text-xl">
          Admin
        </h1>
        <button
          ref={closeRef}
          type="button"
          className="key-button order-2 ml-auto md:order-3 md:ml-0"
          aria-label="Close admin"
          title="Close"
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
        <div className="order-3 w-full overflow-x-auto md:order-2 md:ml-auto md:w-auto">
          <SegmentedTabs label="Admin" idPrefix="admin" tabs={SECTIONS} value={section} onChange={choose} size={sideways ? "sm" : "md"} />
        </div>
      </div>
      <div className="admin-page-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-8">
        <div role="tabpanel" id={panelId("admin", section)} aria-labelledby={tabId("admin", section)} className="mx-auto w-full max-w-[1280px]">
          {section === "overview" && <OverviewPanel onOpen={choose} />}
          {section === "errors" && <ErrorsPanel showToast={showToast} />}
          {section === "problems" && <ProblemsPanel showToast={showToast} />}
          {section === "moderation" && <AdminPanel showToast={showToast} />}
          {section === "announcements" && <AnnouncementsPanel showToast={showToast} />}
          {section === "notice" && <UpdateNoticeCard showToast={showToast} />}
        </div>
      </div>
    </div>
  );
};
