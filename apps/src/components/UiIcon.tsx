import {
  ArrowLeft,
  Bean,
  BookCopy,
  BookOpenText,
  BookPlus,
  Bookmark,
  ChartNoAxesCombined,
  Check,
  Cloud,
  Copy,
  Ellipsis,
  Cookie,
  Grid2X2,
  Hand,
  Layers,
  Heart,
  House,
  LibraryBig,
  List,
  Lock,
  Minus,
  Moon,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shirt,
  ShoppingBag,
  Sparkles,
  Sprout,
  Sun,
  Trash2,
  Upload,
  Droplet,
  Shovel,
  Gamepad2,
  Eye,
  NotebookPen,
  X,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

export type UiIconName =
  | "analytics"
  | "back"
  | "book-add"
  | "book-open"
  | "bookmark"
  | "check"
  | "close"
  | "cloud"
  | "collections"
  | "copy"
  | "edit"
  | "grid"
  | "hand"
  | "heart"
  | "home"
  | "library"
  | "list"
  | "more"
  | "lock"
  | "minus"
  | "moon"
  | "note"
  | "move"
  | "outfit"
  | "pause"
  | "play"
  | "pip"
  | "plus"
  | "search"
  | "seed"
  | "series"
  | "settings"
  | "shop"
  | "sparkle"
  | "sun"
  | "sync"
  | "trash"
  | "treat"
  | "upload"
  | "water"
  | "garden"
  | "game"
  | "preview";

type UiIconProps = Omit<LucideProps, "ref"> & {
  name: UiIconName;
  size?: number;
};

const icons: Record<UiIconName, LucideIcon> = {
  analytics: ChartNoAxesCombined,
  back: ArrowLeft,
  "book-add": BookPlus,
  "book-open": BookOpenText,
  bookmark: Bookmark,
  check: Check,
  close: X,
  cloud: Cloud,
  collections: BookCopy,
  copy: Copy,
  edit: Pencil,
  grid: Grid2X2,
  hand: Hand,
  heart: Heart,
  home: House,
  library: LibraryBig,
  list: List,
  more: Ellipsis,
  lock: Lock,
  minus: Minus,
  moon: Moon,
  note: NotebookPen,
  move: Music,
  outfit: Shirt,
  pause: Pause,
  // Pip's own tab: a sprout, which is what Pip is.
  pip: Sprout,
  play: Play,
  plus: Plus,
  search: Search,
  // Seeds, the currency earned by reading in focus.
  seed: Bean,
  // A series: books stacked in order.
  series: Layers,
  settings: Settings2,
  shop: ShoppingBag,
  sparkle: Sparkles,
  sun: Sun,
  sync: RefreshCw,
  trash: Trash2,
  treat: Cookie,
  upload: Upload,
  // Garden water: minutes of focus.
  water: Droplet,
  garden: Shovel,
  game: Gamepad2,
  preview: Eye
};

export const UiIcon = ({ name, size = 20, ...props }: UiIconProps) => {
  const Icon = icons[name];
  return <Icon aria-hidden="true" size={size} strokeWidth={2} {...props} />;
};
