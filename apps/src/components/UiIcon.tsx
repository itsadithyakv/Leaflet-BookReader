import {
  Bean,
  BookCopy,
  BookOpenText,
  BookPlus,
  Bookmark,
  ChartNoAxesCombined,
  Check,
  Cloud,
  Cookie,
  Grid2X2,
  Hand,
  Heart,
  House,
  LibraryBig,
  List,
  Lock,
  Minus,
  Moon,
  Music,
  Pause,
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
  Upload,
  Droplet,
  Shovel,
  Gamepad2,
  Eye,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

export type UiIconName =
  | "analytics"
  | "book-add"
  | "book-open"
  | "bookmark"
  | "check"
  | "cloud"
  | "collections"
  | "grid"
  | "hand"
  | "heart"
  | "home"
  | "library"
  | "list"
  | "lock"
  | "minus"
  | "moon"
  | "move"
  | "outfit"
  | "pause"
  | "play"
  | "pip"
  | "plus"
  | "search"
  | "seed"
  | "settings"
  | "shop"
  | "sparkle"
  | "sun"
  | "sync"
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
  "book-add": BookPlus,
  "book-open": BookOpenText,
  bookmark: Bookmark,
  check: Check,
  cloud: Cloud,
  collections: BookCopy,
  grid: Grid2X2,
  hand: Hand,
  heart: Heart,
  home: House,
  library: LibraryBig,
  list: List,
  lock: Lock,
  minus: Minus,
  moon: Moon,
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
  settings: Settings2,
  shop: ShoppingBag,
  sparkle: Sparkles,
  sun: Sun,
  sync: RefreshCw,
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
