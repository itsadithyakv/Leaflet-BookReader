import { describe, expect, it } from "vitest";
import { SKINS } from "./core";
import { AVATARS, ownPipAvatar, profilePipAvatar, profileSkinAllowed } from "./avatars";

describe("Pip as a profile picture, in a skin the server refuses", () => {
  it("refuses just the earned skins the server cannot check, as its own lists do", async () => {
    expect(["champ", "golden", "rainbow"].filter(profileSkinAllowed)).toEqual([]);
    expect(["sprout", "robot", "autumn", "nightowl"].every(profileSkinAllowed)).toBe(true);
    expect(profileSkinAllowed("not-a-skin")).toBe(false);
    // The server takes the shop's skins (pipParts.json) and the signup avatars' (AVATAR_IDS, which AVATARS mirrors).
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
    const parts = JSON.parse(fs.readFileSync(new URL("../../../server/src/pipParts.json", import.meta.url), "utf8")) as { skins: string[] };
    const served = new Set([...parts.skins, ...AVATARS.map((avatar) => avatar.skin)]);
    for (const skin of SKINS) expect(profileSkinAllowed(skin.id), skin.id).toBe(served.has(skin.id));
  });

  it("sends the last skin the server took, or the default, with the same move and what shows of the outfit", () => {
    expect(profilePipAvatar("robot", "moonwalk", ["tophat"])).toBe(ownPipAvatar("robot", "moonwalk", ["tophat"]));
    expect(profilePipAvatar("golden", "moonwalk", ["tophat"], "autumn")).toBe(ownPipAvatar("autumn", "moonwalk", ["tophat"]));
    expect(profilePipAvatar("golden", "moonwalk", ["tophat"], null)).toBe(ownPipAvatar("sprout", "moonwalk", ["tophat"]));
    expect(profilePipAvatar("champ", "read", [], "rainbow")).toBe("sprout.read");
    expect(profilePipAvatar("golden", "read", [])).not.toContain("golden");
  });
});
