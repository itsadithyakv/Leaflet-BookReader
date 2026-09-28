import { UiIcon, type UiIconName } from "./UiIcon";
import type { DriveSyncStatus } from "@shared/sync/types";

/**
 * How sync is set up. There is no account tier: sync runs against the reader's
 * own storage, so there is nothing to sign up for and nothing to pay for.
 */
export type SyncMode = "off" | "folder" | "drive";

type AccountBadgeProps = {
  mode: SyncMode;
  status: DriveSyncStatus;
  /** Books in the library whose file is not on this device yet. */
  pending: number;
  onClick: () => void;
  animate: boolean;
};

const modeConfig: Record<SyncMode, { label: string; icon: UiIconName; tooltip: string; className: string }> = {
  off: {
    label: "Local",
    icon: "cloud",
    tooltip: "Not backed up. Connect Google Drive in Settings to keep your library safe.",
    className: "text-on-surface-variant border-outline-variant/40 bg-surface-container-high/70"
  },
  folder: {
    label: "Folder",
    icon: "cloud",
    tooltip: "Syncing through your sync folder",
    className: "text-primary border-primary/30 bg-surface-container-high"
  },
  drive: {
    label: "Drive",
    icon: "cloud",
    tooltip: "Backed up to Google Drive",
    className: "text-primary border-primary/30 bg-surface-container-high"
  }
};

const statusDot = (status: DriveSyncStatus, mode: SyncMode) => {
  if (mode === "off") return "bg-slate-500";
  if (status === "syncing") return "bg-yellow-400";
  if (status === "error") return "bg-red-400";
  if (status === "success") return "bg-emerald-400";
  return "bg-slate-500";
};

export const AccountBadge = ({ mode, status, pending, onClick, animate }: AccountBadgeProps) => {
  const config = modeConfig[mode];
  const tooltip =
    pending > 0
      ? `${config.tooltip} — ${pending} ${pending === 1 ? "book" : "books"} not downloaded yet`
      : config.tooltip;

  return (
    <button
      type="button"
      title={tooltip}
      onClick={onClick}
      className={`leaflet-account-badge ${animate ? "leaflet-account-pop" : ""} ${config.className}`}
    >
      <UiIcon name={config.icon} size={17} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">{config.label}</span>
      <span className={`h-2 w-2 rounded-full ${statusDot(status, mode)}`} />
    </button>
  );
};
