import { describe, expect, it } from "vitest";
import { MENU_CLOSED, MENU_LEAVE_MS, MENU_LINGER_MS, MENU_ROWS, menuItems, menuStep, type Menu, type MenuEvent } from "./menu";

const after = (menu: Menu, events: Array<[MenuEvent["type"], number]>) =>
  events.reduce((current, [type, at]) => menuStep(current, { type } as MenuEvent, at), menu);

describe("desktop Pip's menu", () => {
  it("offers the way in, home, and hidden for today", () => {
    expect(menuItems(false).map((item) => item.label)).toEqual(["Open Leaflet", "Send her home", "Hide for today"]);
  });

  it("offers a way to say no while the sign is up", () => {
    expect(menuItems(true).map((item) => item.id)).toEqual(["putDown", "home", "today"]);
  });

  it("never has more rows than its window has room for, and every row says what it does", () => {
    for (const signUp of [false, true]) {
      const items = menuItems(signUp);
      expect(items.length).toBeLessThanOrEqual(MENU_ROWS);
      for (const item of items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.label.length).toBeLessThanOrEqual(15);
        expect(item.hint.length).toBeGreaterThan(item.label.length);
      }
    }
  });

  it("opens on a right click and closes on the next", () => {
    const opened = menuStep(MENU_CLOSED, { type: "toggle" }, 1000);
    expect(opened.open).toBe(true);
    expect(menuStep(opened, { type: "toggle" }, 1500).open).toBe(false);
  });

  it("opens on a long press, and a second one leaves it open", () => {
    const opened = menuStep(MENU_CLOSED, { type: "press" }, 1000);
    expect(opened.open).toBe(true);
    expect(menuStep(opened, { type: "press" }, 1400)).toBe(opened);
  });

  it("closes by itself when nobody comes to it", () => {
    const opened = menuStep(MENU_CLOSED, { type: "toggle" }, 1000);
    expect(opened.closeAt).toBe(1000 + MENU_LINGER_MS);
    expect(menuStep(opened, { type: "tick" }, 1000 + MENU_LINGER_MS - 1).open).toBe(true);
    expect(menuStep(opened, { type: "tick" }, 1000 + MENU_LINGER_MS).open).toBe(false);
  });

  it("stays while the pointer moves on it, and closes a moment after it leaves", () => {
    const hovered = after(MENU_CLOSED, [
      ["toggle", 1000],
      ["enter", 1200]
    ]);
    expect(hovered).toEqual({ open: true, hover: true, closeAt: null });
    expect(menuStep(hovered, { type: "tick" }, 999_999).open).toBe(true);
    const left = menuStep(hovered, { type: "leave" }, 5000);
    expect(left.closeAt).toBe(5000 + MENU_LEAVE_MS);
    expect(menuStep(left, { type: "tick" }, 5000 + MENU_LEAVE_MS).open).toBe(false);
    // Back on it in time, it stays.
    const back = after(left, [
      ["enter", 5500],
      ["tick", 5000 + MENU_LEAVE_MS]
    ]);
    expect(back.open).toBe(true);
  });

  it("closes when something is picked, and when she is picked up", () => {
    const opened = menuStep(MENU_CLOSED, { type: "toggle" }, 1000);
    expect(menuStep(opened, { type: "pick" }, 1100)).toMatchObject({ open: false, closeAt: null });
    expect(menuStep(opened, { type: "carried" }, 1100).open).toBe(false);
  });

  it("is not opened by the pointer coming and going, or by time passing", () => {
    expect(after(MENU_CLOSED, [["enter", 1], ["leave", 2], ["tick", 99_999], ["pick", 3], ["carried", 4]]).open).toBe(false);
  });
});
