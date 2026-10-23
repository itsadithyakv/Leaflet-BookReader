/**
 * Which part of Settings to show. Settings is a few short sections behind
 * tabs rather than one long page; this remembers the tab for the session, and
 * lets another page send the reader to a particular one ("Sign in" on the
 * Social page goes to Account). Apart from the page itself, so asking for a
 * section does not load it.
 */

export type SettingsSection = "general" | "reading" | "library" | "account";

const SECTION_KEY = "leaflet.settings.section";
const SECTIONS: SettingsSection[] = ["general", "reading", "library", "account"];
/**
 * Tabs there used to be (six, most holding a card or two), and where what was
 * on them is now. Admin is the admin page now, from the profile menu.
 */
const MOVED: Record<string, SettingsSection> = { habit: "reading", about: "general", admin: "general" };

/** The section to open on, falling back to the first when it is unknown or not offered in this build. */
export const readSettingsSection = (offered: SettingsSection[]): SettingsSection => {
  try {
    const kept = sessionStorage.getItem(SECTION_KEY);
    const stored = kept ? (MOVED[kept] ?? kept) as SettingsSection : null;
    if (stored && SECTIONS.includes(stored) && offered.includes(stored)) {
      return stored;
    }
  } catch {
    // The first section, then.
  }
  return offered[0] ?? "general";
};
export const rememberSettingsSection = (section: SettingsSection) => {
  try {
    sessionStorage.setItem(SECTION_KEY, section);
  } catch {
    // This visit only.
  }
};

/** Opens Settings on this section the next time it is shown. */
export const requestSettingsSection = rememberSettingsSection;
