import { SKINS, type PipAccessory, type PipSkin, type PipTreat } from "../../pip";
import { accessories, isEarnedOnly, slotCovered, treats, type ShopKind } from "../../pip/shop";
import type { PipLook } from "../../services/pipService";
import type { ShopRequest } from "../../components/pip/PipShop";
import type { ThingsTab } from "../../components/pip/PipThings";
import { Empty, Group, Hint, Hints, MoveCard, PriceTag, Status, Tile } from "../../components/pip/shopParts";
import type { Tally } from "../../components/pip/collection";
import { PipSprite } from "../../components/PipSprite";
import { moveName, priceOf } from "./common";

const SLOTS: Array<{ slot: PipAccessory["slot"]; label: string; covered: string }> = [
  { slot: "head", label: "Head", covered: "has its own hat" },
  { slot: "face", label: "Face", covered: "already covers the face" },
  { slot: "neck", label: "Neck", covered: "already has something round the neck" },
  { slot: "back", label: "Back", covered: "already wears something on the back" },
  { slot: "hand", label: "Hand", covered: "has its hands full" }
];

type ThingsTabsOptions = {
  owns: (kind: ShopKind, id: string) => boolean;
  variant: string;
  outfit: string[];
  skin: PipSkin | undefined;
  /** The variant the house Pip shows (one being tried on, or bought a moment ago). */
  shownVariant: string;
  signature: string;
  wearing: (id: string) => boolean;
  withAccessory: (id: string, from?: readonly string[]) => string[];
  /** How much of each kind is Pip's (the shop's tallies). */
  tallies: Record<string, Tally>;
  /** Every move: the free signatures, then the ones sold. */
  moveList: Array<{ id: string; price: number }>;
  /** Seeds to spend now. */
  spendable: number;
  change: (patch: Partial<PipLook>) => Promise<void>;
  give: (treat: PipTreat) => Promise<void>;
  play: (move: string, loops?: number, text?: string | null) => void;
  openShop: (request: ShopRequest) => void;
  showToast: (message: string) => void;
};

/**
 * The tabs of Pip's things (components/pip/PipThings.tsx): Looks to wear,
 * Treats to give and Moves to do, each from what Pip owns, with a way into
 * the shop for more.
 */
export const pipThingsTabs = ({
  owns,
  variant,
  outfit,
  skin,
  shownVariant,
  signature,
  wearing,
  withAccessory,
  tallies,
  moveList,
  spendable,
  change,
  give,
  play,
  openShop,
  showToast
}: ThingsTabsOptions): ThingsTab[] => {
  const priceTag = (price: number) => <PriceTag price={price} balance={spendable} />;

  const wardrobeTile = (entry: PipSkin) => {
    const owned = owns("skin", entry.id);
    const worn = entry.id === shownVariant;
    const earned = isEarnedOnly(entry);
    return (
      <Tile
        key={entry.id}
        selected={worn}
        name={entry.name}
        hint={entry.blurb ?? entry.unlock}
        label={`${entry.name}. ${worn ? "Wearing." : owned ? "Select to wear it." : `Locked. Earned by reading: ${entry.unlock}`}`}
        art={(hot) => <PipSprite move="idle" still={!hot && !worn} size={72} snap="nearest" skin={entry.id} outfit={outfit} />}
        status={worn ? <Status icon="check">Wearing</Status> : owned ? <Status>Wear</Status> : <Status icon="lock">Locked</Status>}
        onSelect={() => {
          if (worn) return;
          if (owned) void change({ variant: entry.id });
          else if (earned) showToast(`${entry.name} is earned, not bought: ${entry.unlock}`);
        }}
      />
    );
  };

  const accessoryTile = (entry: PipAccessory) => {
    const worn = wearing(entry.id);
    return (
      <Tile
        key={entry.id}
        selected={worn}
        name={entry.name}
        label={`${entry.name}. ${worn ? "Wearing. Select to take it off." : "Select to wear it."}`}
        art={(hot) => <PipSprite move="idle" still={!hot} size={72} snap="nearest" skin={variant} outfit={withAccessory(entry.id)} />}
        status={worn ? <Status icon="check">Wearing</Status> : <Status>Wear</Status>}
        onSelect={() => void change({ outfit: worn ? outfit.filter((id) => id !== entry.id) : withAccessory(entry.id) })}
      />
    );
  };

  const ownedAccessories = accessories().filter((entry) => owns("accessory", entry.id));
  const looksBody = (
    <>
      <Group title="Variants" tally={tallies.variants}>
        {SKINS.filter((entry) => owns("skin", entry.id)).map(wardrobeTile)}
      </Group>
      {ownedAccessories.length > 0 ? (
        SLOTS.map(({ slot: which, label, covered }) => {
          const items = ownedAccessories.filter((entry) => entry.slot === which);
          if (items.length === 0) return null;
          const hidden = slotCovered(skin, which);
          return (
            <Group key={which} title={label} note={hidden ? `${skin?.name ?? "This variant"} ${covered}: ${label.toLowerCase()} pieces stay off for now.` : undefined}>
              {items.map(accessoryTile)}
            </Group>
          );
        })
      ) : (
        <Empty>No accessories yet: hats, glasses and capes are in the shop.</Empty>
      )}
      <Group title="Earned by reading" note="Never sold, only earned.">
        {SKINS.filter((entry) => isEarnedOnly(entry) && !owns("skin", entry.id)).map(wardrobeTile)}
      </Group>
    </>
  );

  const treatTile = (entry: PipTreat) => {
    const food = entry.kind === "food";
    const price = priceOf("treat", entry.id);
    return (
      <Tile
        key={entry.id}
        name={entry.name}
        label={`${entry.name}. ${food ? `Give Pip one for ${price} seeds.` : "Play with Pip."} Cheers Pip up.`}
        art={(hot) => <PipSprite move={entry.move} still={!hot} size={72} snap="nearest" skin={variant} outfit={outfit} />}
        status={food ? priceTag(price) : <Status icon="heart">Play</Status>}
        onSelect={() => void give(entry)}
      />
    );
  };
  const ownedToys = treats().filter((entry) => entry.kind === "toy" && owns("treat", entry.id));
  const treatsBody = (
    <>
      <Hints>
        <Hint icon="heart" more="Every treat cheers Pip up: the hearts fill.">
          Treats cheer Pip up
        </Hint>
        <Hint icon="seed" more="A snack is bought each time you give it; a toy is bought once.">
          Snacks cost each time
        </Hint>
      </Hints>
      <Group title="Snacks">{treats().filter((entry) => entry.kind === "food").map(treatTile)}</Group>
      <Group title="Toys" tally={tallies.treats}>
        {ownedToys.length > 0 ? ownedToys.map(treatTile) : <p className="col-span-full text-xs text-on-surface-variant">No toys yet.</p>}
      </Group>
    </>
  );

  const movesBody = (
    <>
      <Hints>
        <Hint icon="sparkle" more="Your signature is Pip's idle flourish and your profile picture's move.">
          Signature: Pip's idle move
        </Hint>
        <Hint icon="heart" more="Celebrations stay free: Pip cheers your goals with every move it knows.">
          Cheers are always free
        </Hint>
      </Hints>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}>
        {moveList
          .filter((entry) => owns("move", entry.id))
          .map((entry) => {
            const chosen = entry.id === signature;
            const name = moveName(entry.id);
            return (
              <MoveCard
                key={entry.id}
                name={name}
                art={(hot) => <PipSprite move={entry.id} still={!hot && !chosen} size={72} snap="nearest" skin={variant} outfit={outfit} />}
                selected={chosen}
                status={chosen ? <Status icon="check">Signature</Status> : <Status>{entry.price === 0 ? "Free" : "Yours"}</Status>}
                previewLabel="Do it"
                onPreview={() => play(entry.id, 2)}
                action={chosen ? null : { label: "Signature", run: () => void change({ signature: entry.id }).then(() => play(entry.id, 1, "my new signature move.")) }}
              />
            );
          })}
      </div>
    </>
  );

  return [
    {
      id: "looks",
      label: "Looks",
      icon: "outfit",
      tally: { owned: tallies.variants.owned + tallies.wardrobe.owned, total: tallies.variants.total + tallies.wardrobe.total },
      body: looksBody,
      more: { label: "More looks in the shop", open: () => openShop({ tab: ownedAccessories.length < accessories().length ? "wardrobe" : "variants" }) }
    },
    { id: "treats", label: "Treats", icon: "treat", tally: tallies.treats, body: treatsBody, more: { label: "More toys in the shop", open: () => openShop({ tab: "treats" }) } },
    { id: "moves", label: "Moves", icon: "move", tally: tallies.moves, body: movesBody, more: { label: "More moves in the shop", open: () => openShop({ tab: "moves" }) } }
  ];
};
