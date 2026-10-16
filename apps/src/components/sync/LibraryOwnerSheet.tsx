import { useLibraryOwnerStore } from "../../store/libraryOwnerStore";
import { useLibraryStore } from "../../store/libraryStore";
import { OwnerChoice, OwnerSheetFrame } from "./OwnerSheetFrame";
import { OWNER_COPY } from "./ownerCopy";

/**
 * "Another account's library": signed in as an account this device's library
 * does not belong to. A fresh library of the account's own, or staying out of
 * reading sync. Mounted once (App.tsx); up only while the store asks.
 */
export const LibraryOwnerSheet = () => {
  const open = useLibraryOwnerStore((state) => state.offerOpen);
  const busy = useLibraryOwnerStore((state) => state.busy);
  const elsewhere = useLibraryStore((state) => Boolean(state.sync.library?.elsewhere));

  if (!open) {
    return null;
  }
  const store = useLibraryOwnerStore.getState();
  const close = () => store.closeOffer();

  return (
    <OwnerSheetFrame title={OWNER_COPY.otherTitle} note={OWNER_COPY.otherNote} onClose={close}>
      {elsewhere ? (
        <OwnerChoice label={OWNER_COPY.openMine} note={OWNER_COPY.openMineNote} primary disabled={busy} onClick={() => void store.switchAndReload("mine")} />
      ) : (
        <OwnerChoice label={OWNER_COPY.startFresh} note={OWNER_COPY.startFreshNote} primary disabled={busy} onClick={() => void store.switchAndReload("fresh")} />
      )}
      <OwnerChoice label={OWNER_COPY.stayOut} note={OWNER_COPY.stayOutNote} disabled={busy} onClick={() => void store.stayOut()} />
    </OwnerSheetFrame>
  );
};
