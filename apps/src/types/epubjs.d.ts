declare module "epubjs" {
  type SpineLocation = {
    start?: {
      percentage?: number;
      cfi?: string;
      href?: string;
      index?: number;
    };
    end?: {
      cfi?: string;
    };
  };

  type TocItem = {
    id?: string;
    label: string;
    href: string;
    subitems?: TocItem[];
  };

  type Navigation = {
    toc: TocItem[];
  };

  type Rendition = {
    display: (target?: string) => Promise<void>;
    flow: (mode: "scrolled" | "scrolled-doc" | "paginated") => void;
    on: {
      (event: "relocated", handler: (location: SpineLocation) => void): void;
      (event: "rendered", handler: () => void): void;
      /** Text selected in the page: its CFI range, and the section's contents. */
      (event: "selected", handler: (cfiRange: string, contents: any) => void): void;
    };
    /** Marks drawn over the text (highlights), kept across rendered sections. */
    annotations?: {
      highlight: (
        cfiRange: string,
        data?: Record<string, unknown>,
        onClick?: (event: Event) => void,
        className?: string,
        styles?: Record<string, string>
      ) => unknown;
      remove: (cfiRange: string, type: "highlight" | "underline" | "mark") => void;
    };
    off: {
      (event: "relocated", handler: (location: SpineLocation) => void): void;
      (event: "rendered", handler: () => void): void;
    };
    prev: () => Promise<void>;
    next: () => Promise<void>;
    destroy: () => void;
    themes: {
      register: (name: string, theme: Record<string, Record<string, string>>) => void;
      select: (name: string) => void;
      override: (property: string, value: string) => void;
    };
    hooks?: {
      content?: {
        register: (handler: (contents: any) => void) => void;
      };
    };
    manager?: unknown;
    spread?: (mode: "none" | "auto") => void;
    getContents?: () => any[];
  };

  type EpubBook = {
    renderTo: (element: HTMLElement, options: { width: string | number; height: string | number }) => Rendition;
    loaded: {
      navigation: Promise<Navigation>;
    };
    locations?: {
      generate: (chars?: number) => Promise<unknown>;
      percentageFromCfi: (cfi: string) => number;
    };
    spine?: {
      items?: Array<{ href?: string }>;
    };
    destroy: () => void;
  };

  function ePub(data: ArrayBuffer): EpubBook;

  /** Book positions (CFIs); `compare` orders two of them as they fall in the book. */
  export class EpubCFI {
    constructor(cfi?: string);
    compare(a: string, b: string): number;
  }

  export default ePub;
}
