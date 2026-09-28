/**
 * Public pages the app links to, on Leaflet's GitHub Pages site (built from
 * site/ and docs/legal/). Deliberately not on any paid domain, so they outlive
 * a lapsed registration. Leave empty to hide a link.
 */
const SITE = "https://itsadithyakv.github.io/Leaflet-BookReader";

export const PRIVACY_URL = `${SITE}/privacy/`;
export const TERMS_URL = `${SITE}/terms/`;
export const SUPPORT_EMAIL = "adithyakrishnan.vinod@gmail.com";

/** Leaflet on the Microsoft Store: the rating prompt and "Rate Leaflet" links. */
export const STORE_PRODUCT_ID = "9PH0NLGJFF9W";
/** The web listing; opened in the browser, it hands over to the Store app. */
export const STORE_WEB_URL = `https://apps.microsoft.com/detail/${STORE_PRODUCT_ID}?mode=direct`;
