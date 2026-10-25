import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";
import type { CardInput } from "./cards";

const document = installMiniDom();
// React hears typing by the input event only where the document says it has one.
(document as unknown as { oninput: null }).oninput = null;

describe("Make a card, from a highlight", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let CardMaker: typeof import("./CardMaker").CardMaker;
  const highlight = { id: "h1", text: "The mitral valve  has two\ncusps.", note: "Bicuspid: two.", cfi: "epubcfi(/6/8!/4/2,/1:0,/1:31)", chapter: "The heart" };
  const place = { bookId: "b1", cfi: highlight.cfi, chapter: "The heart", p: 0.3 };

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ CardMaker } = await import("./CardMaker"));
  }, 30_000);

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    for (const child of [...(document.body as unknown as MiniElement).childNodes]) {
      (document.body as unknown as MiniElement).removeChild(child);
    }
  });

  const mount = async (onSave: (card: CardInput) => Promise<void>, kind?: "fill" | "ask") => {
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<CardMaker highlight={highlight} place={place} kind={kind} onSave={onSave} onClose={() => undefined} />));
  };
  const all = (test: (element: MiniElement) => boolean) => (document.body as unknown as MiniElement).findAll(test);
  const button = (label: string) => all((element) => element.tagName === "BUTTON" && element.textContent.trim() === label)[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
  };

  it("fill in: the words pressed are hidden, and the card keeps them and the passage as one line", async () => {
    const onSave = vi.fn(async () => undefined);
    await mount(onSave);
    expect(button("Make card")?.getAttribute("disabled")).not.toBeNull();
    await press(button("mitral"));
    await press(button("two"));
    expect(button("mitral")?.getAttribute("aria-pressed")).toBe("true");
    expect(all((element) => element.getAttribute("role") === "status")[0]?.textContent).toBe("2 blanks");
    await press(button("Make card"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const card = (onSave.mock.calls[0] as unknown as [CardInput])[0];
    expect(card.bookId).toBe("b1");
    expect(card.cfi).toBe(highlight.cfi);
    expect(card.detail).toMatchObject({ t: "fill", s: "The mitral valve has two cusps.", x: [[4, 10], [21, 24]], h: "h1" });
  });

  it("question: the reader's question, and the highlight or the note on it as the answer", async () => {
    const onSave = vi.fn(async () => undefined);
    await mount(onSave, "ask");
    const field = all((element) => element.tagName === "TEXTAREA")[0];
    await React.act(async () => {
      (field as unknown as { value: string }).value = "How many cusps has the mitral valve?";
      field.dispatchEvent(makeEvent("input", field));
    });
    // No hint on the page: it is behind the (i).
    expect((document.body as unknown as MiniElement).textContent).not.toContain("Write a question; the highlight");
    await press(all((element) => element.getAttribute("aria-label") === "About cards")[0]);
    expect((document.body as unknown as MiniElement).textContent).toContain("Write a question; the highlight");
    await press(button("My note"));
    await press(button("Make card"));
    const card = (onSave.mock.calls[0] as unknown as [CardInput])[0];
    expect(card.question).toBe("How many cusps has the mitral valve?");
    expect(card.detail).toMatchObject({ t: "ask", s: "Bicuspid: two.", h: "h1" });
  });

  it("says so when the card could not be kept, and stays open to try again", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("no");
    });
    await mount(onSave);
    await press(button("cusps"));
    await press(button("Make card"));
    await React.act(async () => undefined);
    expect(all((element) => element.getAttribute("role") === "status")[0]?.textContent).toContain("couldn't be kept");
    expect(button("Make card")?.getAttribute("disabled")).toBeNull();
  });
});
