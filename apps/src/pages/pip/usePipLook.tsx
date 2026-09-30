import { useMemo, type ReactNode } from "react";
import { SKINS, renderRoom } from "../../pip";
import { accessories, treats, type ShopKind } from "../../pip/shop";
import { renderFinish, renderItem } from "../../pip/home.js";
import { renderPacket, renderSoil } from "../../pip/garden.js";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import type { PipLook } from "../../services/pipService";
import type { PreviewLook } from "../../components/pip/PipShop";
import { PixelImage } from "../../components/pip/PixelImage";
import { PipSprite } from "../../components/PipSprite";
import { UiIcon } from "../../components/UiIcon";

type PipLookOptions = {
  variant: string;
  outfit: string[];
  setLook: (patch: Partial<PipLook>) => Promise<void>;
  /** A look being tried on from the shop. */
  preview: PreviewLook | null;
  /** A look bought quickly, still in its grace period. */
  pendingLook: PreviewLook | null;
};

/**
 * Pip's look: the variant and what is worn, the look the house Pip shows,
 * and any thing's picture drawn on Pip as it looks now.
 */
export const usePipLook = ({ variant, outfit, setLook, preview, pendingLook }: PipLookOptions) => {
  const skin = SKINS.find((entry) => entry.id === variant);
  const accessoryById = useMemo(() => new Map(accessories().map((item) => [item.id, item])), []);
  const wearing = (id: string) => outfit.includes(id);
  /** The outfit with `id` in its slot (replacing whatever was there). */
  const withAccessory = (id: string, from: readonly string[] = outfit) => {
    const slotOf = accessoryById.get(id)?.slot;
    return [...from.filter((worn) => accessoryById.get(worn)?.slot !== slotOf), id];
  };
  const wearAccessory = (id: string) =>
    setLook({ outfit: withAccessory(id, usePipWardrobeStore.getState().overview?.state.outfit ?? []) });

  // The house Pip: the reader's look, or the one being tried on, or one in its grace period.
  const shownVariant = preview?.variant ?? pendingLook?.variant ?? variant;
  const shownOutfit = preview?.outfit ?? pendingLook?.outfit ?? outfit;

  /** The thing's picture at a size: for the confirm, the toast and the goal. */
  const artFor = (kind: ShopKind, id: string, size: number): ReactNode => {
    const sprite = (move: string, skinId = variant, worn: readonly string[] = outfit) => (
      <PipSprite move={move} still size={size} skin={skinId} outfit={worn} snap="nearest" />
    );
    const image = (render: () => ImageData | null, key: string) => <PixelImage render={render} drawKey={`${key}-${size}`} box={size} />;
    switch (kind) {
      case "skin":
        return sprite("idle", id);
      case "accessory":
        return sprite("idle", variant, withAccessory(id));
      case "treat":
        return sprite(treats().find((entry) => entry.id === id)?.move ?? "idle");
      case "move":
        return sprite(id);
      case "room":
        return image(() => renderItem(id, 0), `item-${id}`);
      case "wallpaper":
      case "flooring":
        return image(() => renderFinish(kind === "wallpaper" ? "wallpaper" : "floor", id, 48, 48), `${kind}-${id}`);
      case "style":
        return image(() => renderRoom(id, 0), `style-${id}`);
      case "plant":
        return image(() => renderPacket(id, 0), `packet-${id}`);
      case "plot":
        return image(() => renderSoil(true), "soil");
      default:
        return <UiIcon name="home" size={Math.round(size * 0.5)} />;
    }
  };

  return { skin, wearing, withAccessory, wearAccessory, shownVariant, shownOutfit, artFor };
};
