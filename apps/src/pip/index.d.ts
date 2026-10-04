/** Typed boundary for the plain-JS Pip engine. */

export type PipSkin = {
  id: string;
  name: string;
  rarity: string;
  unlock: string;
  /** In seeds; 0 is free. Unpriced skins are priced by rarity (see shop.js). */
  price?: number;
  /** An achievement skin: never sold, only earned. */
  earnedOnly?: true;
  /** The skin already has a hat, so a head accessory would clash. */
  hat?: true;
  /** Likewise for the face, neck and back slots. */
  face?: true;
  neck?: true;
  back?: true;
  /** A line of personality, shown in the wardrobe. */
  blurb?: string;
};

export type PipMove = {
  id: string;
  name: string;
  cat: string;
  /** Frames in one loop, at 12 fps. */
  loop: number;
  /** When the app plays it. */
  when: string;
  /** The still frame shown under reduced motion. */
  poster: number;
};

export declare const SKINS: PipSkin[];
export declare function resolve(skin: PipSkin, frame: number): PipSkin;
export declare const LIB: PipMove[];
/** Loads the book scenes into LIB (their own chunk); safe to call repeatedly. */
export declare function loadBookScenes(): Promise<void>;
/** Whether a move is registered yet. */
export declare function hasMove(id: string): boolean;
/** Non-Pip sprites drawn by the same engine: Pip's front door. */
export declare const SCENERY: PipMove[];
export declare function renderFrame(
  move: PipMove,
  frame: number,
  skin: PipSkin,
  opts?: { rim?: string | null } | null
): ImageData;

/** A wardrobe item worn over any variant; one per slot. Price in seeds. */
export type PipAccessory = {
  id: string;
  name: string;
  slot: "head" | "face" | "neck" | "back" | "hand";
  price: number;
};
export declare const ACCESSORIES: PipAccessory[];
/** Draw order of the slots, back to front. */
export declare const SLOT_ORDER: PipAccessory["slot"][];

/** Something for Pip's room, drawn as its own w x h pixel sprite. */
export type PipRoomItem = {
  id: string;
  name: string;
  kind: "furniture" | "wall" | "floor" | "window" | "light";
  price: number;
  w: number;
  h: number;
  /** Where it goes in the room: top-left, in room pixels. */
  at: [number, number];
  /** Hung on the wall, lying on the floor, or standing. Decides draw order. */
  mount: "wall" | "floor" | "stand";
  /** Free, and in every new room. */
  starter?: true;
  /** Slot types it snaps into in the house (house.js). */
  fits?: Array<"ceiling" | "wall" | "window" | "top" | "stand" | "rug">;
  /** The floor it belongs on, or "any". */
  level?: string;
  /** The book it tips its hat to (a title), for the Book Nods shelf. */
  nod?: string;
};
export declare const ROOM_ITEMS: PipRoomItem[];
/** Wallpaper and floor schemes. Unpriced ones are free. */
export type PipRoomStyle = { id: string; name: string; price?: number };
export declare const ROOM_STYLES: PipRoomStyle[];
export declare const ROOM_W: number;
export declare const ROOM_H: number;
/** Where the floor starts, in room pixels. */
export declare const FLOOR_Y: number;
/** Frames in one of the window's days. */
export declare const DAY: number;
/** The frame at which the window shows this hour's sky. */
export declare function skyFrame(hour: number): number;
/** The room in a style, with items placed (top-left, room pixels), ROOM_W x ROOM_H. */
export declare function renderRoom(
  style: string,
  frame: number,
  placed?: ReadonlyArray<{ id: string; x: number; y: number }>
): ImageData;
/** The room art's painter: the engine's drawing API over a canvas of any size. */
export declare class Painter {
  constructor(w: number, h: number, frame?: number);
  w: number;
  h: number;
  toImageData(): ImageData;
}
/** One room item at its own w x h. */
export declare function renderRoomItem(item: PipRoomItem | string, frame: number): ImageData;

/** Food and toys: each plays its own move when given to Pip. */
export type PipTreat = {
  id: string;
  name: string;
  kind: "food" | "toy";
  price: number;
  move: string;
  mood: number;
};
export declare const TREATS: PipTreat[];

/**
 * A skin wearing accessories (drawn over the base; a slot the skin already
 * covers is left off), usable with resolve() and renderFrame(). The skin itself
 * when there are none.
 */
export declare function dress(skin: PipSkin, accessoryIds: readonly string[] | null | undefined): PipSkin;

/** A floor of Pip's house (house.js). 240 x 120. */
export type PipHouseLevel = {
  id: string;
  name: string;
  w: number;
  h: number;
  floorY: number;
  price: number;
  unlock: { after: string | null; sessions: number };
  unlockText: string;
  night: boolean;
  wallpaper: string;
  floor: string;
  blurb: string;
  slots: Array<{ id: string; fits: string; x: number; y: number; w: number; h: number }>;
};
export type PipFinish = { id: string; name: string; price: number };
export declare const HOUSE_LEVELS: PipHouseLevel[];
export declare const WALLPAPERS: PipFinish[];
export declare const FLOORS: PipFinish[];
export declare const HOUSE_ITEMS: PipRoomItem[];
export declare const NOD_ITEMS: PipRoomItem[];
export declare const ALL_ITEMS: PipRoomItem[];
/** What a floor has that is not decor (the bedroom's mini fridge, shut and open): never in the shop or the layout. */
export declare const FIXTURES: PipRoomItem[];
export declare function placeAt(item: PipRoomItem, slot: { fits: string; x: number; y: number }): { x: number; y: number };
export declare function renderLevel(
  levelId: string,
  frame: number,
  opts?: { wallpaper?: string; floor?: string; placed?: Array<{ slot: string; itemId: string }>; night?: boolean }
): ImageData;
export declare function renderHouseItem(item: PipRoomItem | string, frame?: number): ImageData;
export declare function renderSwatch(type: "wallpaper" | "floor", id: string, w?: number, h?: number, frame?: number): ImageData;

/** Arcade art (games-art.js): Pip poses are move-shaped; sprites draw with the room Painter. */
export type PipGameSprite = { w: number; h: number; box?: [number, number, number, number] | null; frames?: number };
export type PipGamePose = PipMove & { box: [number, number, number, number] };
export declare const GAME_SPRITES: Record<string, Record<string, unknown>>;
export declare const GAME_POSES: PipGamePose[];
export declare function renderGameSprite(sprite: PipGameSprite, frame?: number, opts?: { h?: number; top?: boolean; letter?: string; variant?: number }): ImageData;
