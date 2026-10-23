import { Suspense, lazy } from "react";
import { create } from "zustand";

/**
 * The owner's admin page: opened from the profile menu (only for the
 * account the server calls the admin), over the whole app. Its code is a
 * chunk of its own, loaded the first time it opens, so it costs a reader
 * who is not the owner nothing at all.
 */
type AdminPageState = { open: boolean; show: () => void; close: () => void };

export const useAdminPage = create<AdminPageState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false })
}));

const AdminPage = lazy(() => import("./AdminPage").then((module) => ({ default: module.AdminPage })));

/** Mounted once, at the top of the app; draws nothing until the page is opened. */
export const AdminHost = ({ showToast }: { showToast: (message: string) => void }) => {
  const open = useAdminPage((state) => state.open);
  const close = useAdminPage((state) => state.close);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <AdminPage onClose={close} showToast={showToast} />
    </Suspense>
  );
};
