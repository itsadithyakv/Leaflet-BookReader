/**
 * Which part of Settings to show. Settings is a few short sections behind
 * tabs rather than one long page; this remembers the tab for the session, and
 * lets another page send the reader to a particular one ("Sign in" on the
 * Social page goes to Account). Apart from the page itself, so asking for a
 * section does not load it.
 */

export type SettingsSection = "general" | "reading" | "library" | "account" | "about";

const SECTION_KEY = "leaflet.settings.section";
const SECTIONS: SettingsSection[] = ["general", "reading", "library", "account", "about"];

/** The section to open on, falling back to the first when it is unknown or not offered in this build. */
export const readSettingsSection = (offered: SettingsSection[]): SettingsSection => {
  try {
    const stored = sessionStorage.getItem(SECTION_KEY) as SettingsSection | null;
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
