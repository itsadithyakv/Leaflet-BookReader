import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { decidePlace } from "./placeElsewhere";

const book = (progress: number, position: string | null): Book =>
  ({ id: "aaa", title: "A book", progress, position, localPath: "/books/aaa.epub" }) as Book;

describe("which place a book opens at, and which is offered", () => {
  it("a book never read here opens at the agreed place, with nothing to offer", () => {
    const { open, offer } = decidePlace(book(0.62, "epubcfi(/6/30)"), null);
    expect(open).toEqual({ progress: 0.62, position: "epubcfi(/6/30)" });
    expect(offer).toBeNull();
  });

  it("opens where this device left it and offers the further place: never moved silently", () => {
    const { open, offer } = decidePlace(book(0.62, "epubcfi(/6/30)"), { progress: 0.2, position: "epubcfi(/6/8)" });
    expect(open).toEqual({ progress: 0.2, position: "epubcfi(/6/8)" });
    expect(offer).toEqual({ bookId: "aaa", there: { progress: 0.62, position: "epubcfi(/6/30)" }, ahead: true });
  });

  it("an other device behind this one is offered too, as where it was last", () => {
    const { open, offer } = decidePlace(book(0.1, null), { progress: 0.4, position: null });
    expect(open.progress).toBe(0.4);
    expect(offer?.ahead).toBe(false);
  });

  it("the same place, give or take a few lines, offers nothing", () => {
    expect(decidePlace(book(0.5, "epubcfi(/6/20!/4/2)"), { progress: 0.5005, position: "epubcfi(/6/20!/4/6)" }).offer).toBeNull();
    expect(decidePlace(book(0.5, null), { progress: 0.5, position: null }).offer).toBeNull();
  });
});
