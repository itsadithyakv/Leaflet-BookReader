type AccountTier = "offline" | "cloud" | "premium";
type SyncState = "offline" | "pending" | "synced" | "error";

type AccountBadgeProps = {
  tier: AccountTier;
  syncState: SyncState;
  onClick: () => void;
  animate: boolean;
};

const tierConfig: Record<AccountTier, { label: string; icon: string; tooltip: string; className: string }> = {
  offline: {
    label: "Offline",
    icon: "eco",
    tooltip: "Sign in to sync your reading across devices",
    className: "text-on-surface-variant border-outline-variant/40 bg-surface-container-high/70"
  },
  cloud: {
    label: "Cloud",
    icon: "eco",
    tooltip: "Sync enabled. Upgrade for premium features",
    className: "text-primary border-primary/30 bg-surface-container-high"
  },
  premium: {
    label: "Premium",
    icon: "auto_awesome",
    tooltip: "Premium active — sync & extras unlocked",
    className: "leaflet-premium-badge"
  }
};

const syncDot = (state: SyncState) => {
  if (state === "pending") return "bg-yellow-400";
  if (state === "synced") return "bg-emerald-400";
  if (state === "error") return "bg-red-400";
  return "bg-slate-500";
};

export const AccountBadge = ({ tier, syncState, onClick, animate }: AccountBadgeProps) => {
  const config = tierConfig[tier];
  return (
    <button
      type="button"
      title={config.tooltip}
      onClick={onClick}
      className={`leaflet-account-badge ${animate ? "leaflet-account-pop" : ""} ${config.className}`}
    >
      <span className="material-symbols-outlined text-base">{config.icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">{config.label}</span>
      <span className={`h-2 w-2 rounded-full ${syncDot(syncState)}`} />
    </button>
  );
};
