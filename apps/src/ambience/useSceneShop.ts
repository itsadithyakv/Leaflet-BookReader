import { useCallback, useMemo, useState } from "react";
import { usePipWardrobeStore } from "../store/pipWardrobeStore";
import { ambience } from "./ambience";
import { SCENES, type SceneId } from "./scenes";
import { lockedScenes, seedsShort } from "./unlock";

/** A locked sound the reader is looking at: what it costs, and whether the seeds are there. */
export type SceneOffer = {
  scene: SceneId;
  name: string;
  price: number;
  /** Seeds still to earn; 0 when it can be bought now. */
  short: number;
  /** The wallet is known (the Pip overview has loaded): until then nothing is said of the price being in reach. */
  ready: boolean;
  /** The purchase is on its way to Rust. */
  buying: boolean;
  /** Why it was refused, as Rust said it. */
  error: string | null;
};

/**
 * The radio's side of Pip's shop: which sounds are still to be bought (from
 * the same overview the shop reads, in the wardrobe store), the one the
 * reader has selected to look at, and buying it with the shop's own call
 * (`pip_buy`, kind "sound"). Rust names the price and refuses what cannot
 * be afforded; once bought the sound is chosen, and `onBought` lets a panel
 * start listening to it.
 */
export const useSceneShop = (playing: SceneId, onBought?: (scene: SceneId) => void) => {
  const owned = usePipWardrobeStore((state) => state.overview?.owned);
  const loaded = usePipWardrobeStore((state) => state.overview !== null);
  const balance = usePipWardrobeStore((state) => state.overview?.wallet.balance ?? 0);
  const buy = usePipWardrobeStore((state) => state.buy);
  const [looking, setLooking] = useState<SceneId | null>(null);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = useMemo(() => lockedScenes(owned, playing), [owned, playing]);
  const price = looking ? locked.get(looking) : undefined;

  const look = useCallback((scene: SceneId | null) => {
    setLooking(scene);
    setError(null);
  }, []);

  const buyIt = useCallback(async () => {
    if (!looking || buying) {
      return;
    }
    setBuying(true);
    setError(null);
    try {
      await buy("sound", looking);
      // Bought: it is what the radio plays now.
      ambience.chooseScene(looking);
      onBought?.(looking);
      setLooking(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuying(false);
    }
  }, [looking, buying, buy, onBought]);

  const offer: SceneOffer | null =
    looking && price !== undefined
      ? { scene: looking, name: SCENES[looking].name, price, short: loaded ? seedsShort(price, balance) : 0, ready: loaded, buying, error }
      : null;

  return { locked, offer, look, buy: buyIt };
};
