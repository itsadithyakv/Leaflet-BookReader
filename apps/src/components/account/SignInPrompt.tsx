import { FEATURES } from "../../constants/features";
import { PipSprite } from "../PipSprite";
import { useAccountDialog } from "./AccountDialog";

/**
 * Where a page needs an account (Social's board, Friends, Discover): one short
 * line and one button, which opens the account form right there. A build
 * without accounts has no form to open, and goes to Settings instead.
 */
export const SignInPrompt = ({ line, onSettings }: { line: string; onSettings: () => void }) => (
  <section className="paper-surface flex items-center gap-3 rounded-xl p-4">
    <PipSprite move="welcome" size={40} still />
    <p className="min-w-0 flex-1 text-sm font-semibold text-on-surface">{line}</p>
    <button
      type="button"
      className="tactile-button tactile-button-primary shrink-0 px-4 py-2 text-xs font-semibold"
      onClick={() => (FEATURES.accounts ? useAccountDialog.getState().show("signin") : onSettings())}
    >
      Sign in
    </button>
  </section>
);
