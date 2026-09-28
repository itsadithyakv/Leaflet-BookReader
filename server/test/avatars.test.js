import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AVATAR_IDS, PIP_PARTS, avatarRules, avatarView, isAvatar, parseAvatar } from "../src/avatars.js";

/**
 * The server's avatar allowlists against the app's catalogues. The signup
 * catalogue is read as text and the shop's parts are rebuilt by the app's own
 * generator, so the server needs nothing from the app to run. Skipped when the
 * server is checked out on its own.
 */

const pip = (name) => fileURLToPath(new URL(`../../apps/src/pip/${name}`, import.meta.url));
const catalogue = pip("avatars.ts");
const generator = fileURLToPath(new URL("../../apps/scripts/pip-catalogue.mjs", import.meta.url));
const haveApp = existsSync(catalogue);

// A fixed set of parts, so the rules are tested whatever the art holds today.
const FIXTURE = {
  skins: ["sprout", "robot", "king"],
  moves: ["read", "moonwalk"],
  accessories: { tophat: "head", crown: "head", scarf: "neck", monocle: "face" }
};

describe("avatars", () => {
  test("validation is strict", () => {
    assert.equal(isAvatar("wizard.magic"), true);
    for (const value of ["", "wizard", "wizard.", ".magic", "Wizard.magic", " wizard.magic", "wizard.magic.", "champ.champ", "wizard.teleport", null, 7, { id: "wizard.magic" }]) {
      assert.equal(isAvatar(value), false, JSON.stringify(value));
    }
    assert.equal(avatarView("golden.champ"), null);
    assert.equal(avatarView(undefined), null);
  });

  test("every value from before the Pip tab is still valid", () => {
    for (const id of AVATAR_IDS) {
      assert.equal(isAvatar(id), true, id);
      assert.deepEqual(parseAvatar(id).outfit, []);
    }
  });

  test("never an earned-only skin", () => {
    for (const id of AVATAR_IDS) {
      assert.ok(!["champ", "golden", "rainbow"].includes(id.split(".")[0]), id);
    }
    for (const skin of ["champ", "golden", "rainbow"]) {
      assert.ok(!PIP_PARTS.skins.includes(skin), `${skin} is not on sale, so not an avatar part`);
      assert.equal(isAvatar(`${skin}.read`), false);
    }
  });

  test("a reader's own Pip: any variant, signature and outfit on offer", () => {
    const { parse } = avatarRules(FIXTURE);
    assert.deepEqual(parse("robot.moonwalk"), { skin: "robot", move: "moonwalk", outfit: [] });
    assert.deepEqual(parse("king.read.tophat+scarf+monocle"), {
      skin: "king",
      move: "read",
      outfit: ["tophat", "scarf", "monocle"]
    });
    // Old catalogue skins and moves remain parts, so old values stay valid.
    assert.ok(parse("wizard.magic"));
    assert.ok(parse("ghost.moonwalk"));
  });

  test("each part is checked on its own", () => {
    const { parse } = avatarRules(FIXTURE);
    for (const value of [
      "robot.moonwalk.",
      "robot.moonwalk.tophat+",
      "robot.moonwalk.+tophat",
      "robot.moonwalk.tophat++scarf",
      "robot.moonwalk.cape",
      "robot.moonwalk.tophat+crown",
      "robot.moonwalk.tophat+tophat",
      "robot.moonwalk.Tophat",
      "robot.moonwalk.tophat.scarf",
      "golden.moonwalk",
      "robot.teleport",
      "robot.moonwalk.tophat+scarf+monocle+" + "x".repeat(200)
    ]) {
      assert.equal(parse(value), null, value);
    }
  });

  test("matches the app's catalogue, and every skin and move exists", { skip: !haveApp && "apps/ not checked out" }, () => {
    const text = readFileSync(catalogue, "utf8");
    const ids = [...text.matchAll(/\bentry\("([a-z]+\.[a-z]+)"/g)].map((match) => match[1]);
    assert.ok(ids.length >= 16, "the catalogue should have at least 16 avatars");
    assert.equal(new Set(ids).size, ids.length, "ids in the app's catalogue are unique");
    assert.deepEqual([...ids].sort(), [...AVATAR_IDS].sort());

    const skins = readFileSync(pip("skins.js"), "utf8");
    const moves = readFileSync(pip("anims.js"), "utf8");
    for (const id of ids) {
      const [skin, move] = id.split(".");
      assert.match(skins, new RegExp(`id: "${skin}"`), `skin ${skin}`);
      assert.match(moves, new RegExp(`def\\("${move}"`), `move ${move}`);
    }
  });

  test("the own-Pip parts match the app's shop", { skip: !haveApp && "apps/ not checked out" }, async () => {
    const { buildCatalogue } = await import(pathToFileURL(generator).href);
    const { server } = await buildCatalogue();
    const { note: _ignored, ...expected } = server;
    const { note: _alsoIgnored, ...actual } = PIP_PARTS;
    assert.deepEqual(actual, expected, "stale server/src/pipParts.json: run `node scripts/pip-catalogue.mjs` in apps/");
  });
});
