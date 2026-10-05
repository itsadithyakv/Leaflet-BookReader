/**
 * Pip's world, set by hand: for the house's development hook and the preview,
 * where there is no streak to break, no friend to visit and no session to be
 * out for. Whatever is set here is laid over what the page gathers
 * (pages/pip/usePipWorld.ts), field by field. Nothing sets it in a release
 * build, where it stays null.
 */
import type { World } from "./behaviour";

let stub: World | null = null;
const watchers = new Set<() => void>();

export const worldStub = () => stub;

/** Lays these fields over the world; null takes the stub away. */
export const setWorldStub = (patch: World | null) => {
  stub = patch ? { ...stub, ...patch } : null;
  watchers.forEach((notify) => notify());
};

export const watchWorldStub = (onChange: () => void) => {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
};
