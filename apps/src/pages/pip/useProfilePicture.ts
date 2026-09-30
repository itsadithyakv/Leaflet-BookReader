import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { ownPipAvatar } from "../../pip/avatars";
import { useAccountStore } from "../../store/accountStore";
import { FEATURES } from "../../constants/features";
import { errorText } from "./common";

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
  const myAvatar = ownPipAvatar(variant, signature, outfit);
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
