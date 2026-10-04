import {
  Armchair,
  ArrowLeft,
  Backpack,
  Bean,
  BookA,
  BookCopy,
  BookOpenText,
  BookPlus,
  Bookmark,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Cloud,
  Copy,
  Ellipsis,
  ExternalLink,
  Cookie,
  Grid2X2,
  Hand,
  Layers,
  Heart,
  Highlighter,
  House,
  Info,
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
  Target,
  Trash2,
  Undo2,
  Upload,
  Droplet,
  Shovel,
  Gamepad2,
  Eye,
  NotebookPen,
  UserRoundSearch,
  Users,
  Waypoints,
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
  | "dictionary"
  | "edit"
  | "external"
  | "grid"
  | "hand"
  | "heart"
  | "highlight"
  | "home"
  | "info"
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
  | "preview"
  | "things"
  | "decorate"
  | "help"
  | "goal"
  | "undo"
  | "up"
  | "down"
  | "people"
  | "who"
  | "relations";

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
  // Look a word up: a book with a letter on it.
  dictionary: BookA,
  edit: Pencil,
  // A link that opens in the browser.
  external: ExternalLink,
  grid: Grid2X2,
  hand: Hand,
  heart: Heart,
  highlight: Highlighter,
  home: House,
  info: Info,
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
  preview: Eye,
  // Pip's tab: what Pip owns, carried in a backpack; furnishing the house.
  things: Backpack,
  decorate: Armchair,
  help: CircleHelp,
  // A thing in the shop pinned as the reader's goal.
  goal: Target,
  undo: Undo2,
  up: ChevronUp,
  down: ChevronDown,
  people: Users,
  who: UserRoundSearch,
  relations: Waypoints
};

export const UiIcon = ({ name, size = 20, ...props }: UiIconProps) => {
  const Icon = icons[name];
  return <Icon aria-hidden="true" size={size} strokeWidth={2} {...props} />;
};
