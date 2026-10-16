import { askConfirm } from "../ConfirmDialog";
import { useLibraryOwnerStore } from "../../store/libraryOwnerStore";
import { useLibraryStore } from "../../store/libraryStore";
import { OwnerChoice, OwnerSheetFrame } from "./OwnerSheetFrame";
import { OWNER_COPY } from "./ownerCopy";

/**
 * "Your account already has a library": a fresh library's first sync met what
 * the account held from before, and merged nothing. Use it, or start empty
 * (which replaces it, so it is asked twice). Mounted once (App.tsx); up while
 * the library store holds the count. Put away, it is asked again at the next
 * sync.
 */
export const AccountHoldsSheet = () => {
  const books = useLibraryStore((state) => state.accountHolds);
  const busy = useLibraryOwnerStore((state) => state.busy);

  if (books === null) {
    return null;
  }
  const close = () => useLibraryStore.getState().dismissAccountHolds();
  const answer = (useIt: boolean) => useLibraryOwnerStore.getState().answerHolds(useIt);
  const startEmpty = async () => {
    const sure = await askConfirm({
      title: OWNER_COPY.startEmptyConfirmTitle,
      body: OWNER_COPY.startEmptyConfirmBody,
      confirmLabel: OWNER_COPY.startEmpty,
      cancelLabel: "Keep it",
      danger: true
    });
    if (sure) await answer(false);
  };

  return (
    <OwnerSheetFrame title={OWNER_COPY.holdsTitle(books)} note={OWNER_COPY.holdsNote} onClose={close}>
      <OwnerChoice label={OWNER_COPY.useIt} note={OWNER_COPY.useItNote} primary disabled={busy} onClick={() => void answer(true)} />
      <OwnerChoice label={OWNER_COPY.startEmpty} note={OWNER_COPY.startEmptyNote} danger disabled={busy} onClick={() => void startEmpty()} />
    </OwnerSheetFrame>
  );
};
