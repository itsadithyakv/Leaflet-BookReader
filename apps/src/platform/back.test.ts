import { describe, expect, it } from "vitest";
import { handleBack, openBackLayers, pushBackLayer, setBackFallback } from "./back";

describe("Back", () => {
  it("closes the newest thing open first, one press at a time", () => {
    const closed: string[] = [];
    pushBackLayer(() => closed.push("panel"));
    pushBackLayer(() => closed.push("sheet"));
    expect(openBackLayers()).toBe(2);
    expect(handleBack()).toBe(true);
    expect(handleBack()).toBe(true);
    expect(closed).toEqual(["sheet", "panel"]);
    expect(openBackLayers()).toBe(0);
  });

  it("forgets a layer closed some other way", () => {
    const closed: string[] = [];
    pushBackLayer(() => closed.push("panel"));
    const remove = pushBackLayer(() => closed.push("sheet"));
    remove();
    handleBack();
    expect(closed).toEqual(["panel"]);
  });

  it("asks the fallbacks, newest first, and lets the app go when none takes it", () => {
    const asked: string[] = [];
    const app = setBackFallback(() => {
      asked.push("app");
      return false;
    });
    const reader = setBackFallback(() => {
      asked.push("reader");
      return true;
    });
    expect(handleBack()).toBe(true);
    expect(asked).toEqual(["reader"]);
    reader();
    expect(handleBack()).toBe(false);
    expect(asked).toEqual(["reader", "app"]);
    app();
  });
});
