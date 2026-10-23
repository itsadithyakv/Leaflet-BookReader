import { Megaphone, X } from "lucide-react";
import type { Announcement } from "../../services/adminService";
import { buttonOf, type Button } from "../../services/announcements";
import "./announcement.css";

type Props = {
  item: Pick<Announcement, "title" | "body" | "link">;
  /** The reader put it away (the cross, or "OK"). */
  onDismiss: () => void;
  /** The button was pressed: a link to open, or an action the app knows. */
  onButton: (button: Button) => void;
  /** In the owner's preview: drawn in place, not at the foot of the window. */
  inline?: boolean;
};

/**
 * One announcement from the owner, as a reader sees it: a card at the foot
 * of the window with its title, its words, and at most one button. The same
 * card is the admin page's preview, so what the owner sees is what is sent.
 * Opaque paper, no blur, and a short rise that a reader who asks for less
 * motion does not get.
 */
export const AnnouncementCard = ({ item, onDismiss, onButton, inline = false }: Props) => {
  const button = buttonOf(item.link);
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="announcement-title"
      className={`announcement-card paper-surface-raised rounded-2xl p-4 shadow-lg ${inline ? "is-inline" : ""}`}
    >
      <div className="flex items-start gap-3">
        <Megaphone size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p id={inline ? undefined : "announcement-title"} className="text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">
            {item.title || "Title"}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">
            {item.body || "Message"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {button && (
              <button type="button" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs" onClick={() => onButton(button)}>
                {button.label}
              </button>
            )}
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={onDismiss}>
              OK
            </button>
          </div>
        </div>
        <button
          type="button"
          className="touch-hit shrink-0 rounded-full p-1 text-on-surface-variant hover:text-on-surface"
          aria-label="Put away"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
};
