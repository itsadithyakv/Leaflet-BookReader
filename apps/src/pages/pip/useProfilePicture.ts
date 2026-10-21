import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { profilePipAvatar, profileSkinAllowed } from "../../pip/avatars";
import { useAccountStore } from "../../store/accountStore";
import { FEATURES } from "../../constants/features";
import { errorText, storage } from "./common";

/** The last skin Pip wore that the server takes on a profile picture (this device's). */
const LAST_SKIN_KEY = "pip.lastProfileSkin";

const lastProfileSkin = () => {
  try {
    return storage()?.getItem(LAST_SKIN_KEY) ?? null;
  } catch {
    return null;
  }
};

type ProfilePictureOptions = {
  variant: string;
  signature: string;
  outfit: string[];
  play: (move: string, loops?: number, text?: string | null) => void;
  showToast: (message: string) => void;
};

/** Pip as the reader's profile picture, for a reader with an account (Seeds and mood offers it). */
export const useProfilePicture = ({ variant, signature, outfit, play, showToast }: ProfilePictureOptions) => {
  const { account, signedIn, accountsLoaded, loadAccount, setAvatar } = useAccountStore(
    useShallow((store) => ({
      account: store.status.account,
      signedIn: store.status.signedIn,
      accountsLoaded: store.loaded,
      loadAccount: store.load,
      setAvatar: store.setAvatar
    }))
  );
  useEffect(() => {
    if (FEATURES.accounts && !accountsLoaded) void loadAccount();
  }, [accountsLoaded, loadAccount]);
  // Remembered while Pip wears a skin the server takes, so one it refuses (an earned Golden Pip) can stand in for it.
  useEffect(() => {
    if (!profileSkinAllowed(variant)) return;
    try {
      storage()?.setItem(LAST_SKIN_KEY, variant);
    } catch {
      // The default skin stands in instead.
    }
  }, [variant]);
  const myAvatar = profilePipAvatar(variant, signature, outfit, profileSkinAllowed(variant) ? variant : lastProfileSkin());
  const avatarInUse = account?.avatar === myAvatar;
  const useMyPip = async () => {
    try {
      await setAvatar(myAvatar);
      showToast("Your Pip is your profile picture now.");
      play(signature, 2, "say cheese.");
    } catch (cause) {
      showToast(errorText(cause));
    }
  };

  return { myAvatar, signedIn, avatarInUse, useMyPip };
};
