/**
 * Hands the house and game art to home.js, which reads the art through one
 * registration so it can also run under plain Node (the catalogue generator,
 * scripts/pip-catalogue.mjs, registers the same modules). Import this module
 * (for its side effect) before reading the house.
 */
import { registerHouseArt } from "./home.js";
import * as pip from "./index";

registerHouseArt(pip as unknown as Record<string, unknown>);
