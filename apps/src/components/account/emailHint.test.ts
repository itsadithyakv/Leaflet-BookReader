import { describe, expect, it } from "vitest";
import { emailHint } from "./emailHint";

describe("the typo hint under the email field", () => {
  it("offers the common domain a slip away", () => {
    // Swapped neighbours, a wrong letter, one missing, one too many.
    expect(emailHint("ada@gmial.com")).toBe("ada@gmail.com");
    expect(emailHint("ada@gmail.con")).toBe("ada@gmail.com");
    expect(emailHint("ada@hotmial.com")).toBe("ada@hotmail.com");
    expect(emailHint("ada@outlok.com")).toBe("ada@outlook.com");
    expect(emailHint("ada@yaho.com")).toBe("ada@yahoo.com");
    expect(emailHint("ada@gmaill.com")).toBe("ada@gmail.com");
    expect(emailHint("ada@gmail.co")).toBe("ada@gmail.com");
    expect(emailHint("ada@gmail.cmo")).toBe("ada@gmail.com");
    expect(emailHint("ada@iclould.com")).toBe("ada@icloud.com");
    expect(emailHint("ada@googlmail.com")).toBe("ada@googlemail.com");
    expect(emailHint("ada@protonmial.com")).toBe("ada@protonmail.com");
    expect(emailHint("ada@proton.em")).toBe("ada@proton.me");
    expect(emailHint("ada@protn.me")).toBe("ada@proton.me");
  });

  it("offers the ending that was never typed", () => {
    expect(emailHint("ada@gmail")).toBe("ada@gmail.com");
    expect(emailHint("ada@proton")).toBe("ada@proton.me");
  });

  it("keeps the name as typed and reads the domain in any case", () => {
    expect(emailHint("  Ada.Lovelace+books@GMIAL.COM ")).toBe("Ada.Lovelace+books@gmail.com");
  });

  it("says nothing about an address that looks right", () => {
    for (const fine of [
      "ada@gmail.com",
      "ada@GMail.com",
      "ada@googlemail.com",
      "ada@outlook.com",
      "ada@hotmail.com",
      "ada@yahoo.com",
      "ada@icloud.com",
      "ada@proton.me",
      "ada@protonmail.com"
    ]) {
      expect(emailHint(fine), fine).toBeNull();
    }
  });

  it("leaves real domains alone, however close they look", () => {
    for (const real of [
      "ada@mail.com",
      "ada@email.com",
      "ada@ymail.com",
      "ada@gmx.com",
      "ada@me.com",
      "ada@pm.me",
      "ada@live.com",
      "ada@yahoo.co.uk",
      "ada@yahoo.ca",
      "ada@hotmail.co.uk",
      "ada@hotmail.fr",
      "ada@outlook.de",
      "ada@protonmail.ch",
      "ada@example.com",
      "ada@university.edu"
    ]) {
      expect(emailHint(real), real).toBeNull();
    }
  });

  it("does not guess at two slips, or at what is not yet an address", () => {
    expect(emailHint("ada@gmial.con")).toBeNull();
    expect(emailHint("ada@gnial.com")).toBeNull();
    expect(emailHint("")).toBeNull();
    expect(emailHint("ada")).toBeNull();
    expect(emailHint("ada@")).toBeNull();
    expect(emailHint("@gmial.com")).toBeNull();
    expect(emailHint("ada lovelace@gmial.com")).toBeNull();
  });
});
