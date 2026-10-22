import { useLibraryOwnerStore } from "../../store/libraryOwnerStore";
import { useLibraryStore } from "../../store/libraryStore";
import { OwnerChoice, OwnerSheetFrame } from "./OwnerSheetFrame";
import { OWNER_COPY } from "./ownerCopy";

/**
 * "Your Google Drive has a library": signed in, Drive (or the sync folder)
 * holds a library Leaflet saved there before accounts, which may be another
 * reader's on a shared Google account. Nothing of it was taken. Use it, or
 * keep it apart (it then carries only this library's book files). Mounted
 * once (App.tsx), as AccountHoldsSheet; put away, it is asked again at the
 * next sync.
 */
export const StoreHoldsSheet = () => {
  const holds = useLibraryStore((state) => state.storeHolds);
  const busy = useLibraryOwnerStore((state) => state.busy);

  if (holds === null) {
    return null;
  }
  const close = () => useLibraryStore.getState().dismissStoreHolds();
  const answer = (useIt: boolean) => useLibraryOwnerStore.getState().answerStoreHolds(useIt);

  return (
    <OwnerSheetFrame title={OWNER_COPY.storeHoldsTitle(holds.transport, holds.books)} note={OWNER_COPY.storeHoldsNote} onClose={close}>
      <OwnerChoice label={OWNER_COPY.useIt} note={OWNER_COPY.useItNote} primary disabled={busy} onClick={() => void answer(true)} />
      <OwnerChoice label={OWNER_COPY.keepApart} note={OWNER_COPY.keepApartNote} disabled={busy} onClick={() => void answer(false)} />
    </OwnerSheetFrame>
  );
};
