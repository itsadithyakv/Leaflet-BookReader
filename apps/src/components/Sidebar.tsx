const navItems = [
  { label: "Library", icon: "auto_stories" },
  { label: "Collections", icon: "collections_bookmark" },
  { label: "Analytics", icon: "insights" }
];

type SidebarProps = {
  activeItem: string;
  onNavigate: (label: string) => void;
  onStartReading: () => void;
  startDisabled?: boolean;
};

export const Sidebar = ({ activeItem, onNavigate, onStartReading, startDisabled }: SidebarProps) => {
  return (
    <aside className="hidden h-full w-64 flex-col border-r border-primary/10 bg-surface-container-low px-4 py-4 shadow-[10px_0_40px_rgba(0,0,0,0.5)] md:flex">
      <nav className="flex-1 space-y-2 px-2 text-sm">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition ${
              item.label === activeItem
                ? "bg-surface-container-high text-primary"
                : "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
            }`}
            type="button"
            onClick={() => onNavigate(item.label)}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className={item.label === activeItem ? "font-semibold" : ""}>{item.label}</span>
          </button>
        ))}
      </nav>

      <button
        className={`mx-2 mb-4 flex w-auto items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition ${
          activeItem === "Settings"
            ? "bg-surface-container-high text-primary"
            : "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
        }`}
        type="button"
        onClick={() => onNavigate("Settings")}
      >
        <span className="material-symbols-outlined">settings</span>
        <span className={activeItem === "Settings" ? "font-semibold" : ""}>Settings</span>
      </button>

      <div className="mt-auto px-2">
        <button
          className="w-full rounded-full bg-primary py-4 text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={onStartReading}
          disabled={startDisabled}
        >
          Start Reading
        </button>
      </div>
    </aside>
  );
};
