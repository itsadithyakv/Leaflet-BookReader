export type BookFormat = {
  extension: string;
  label: string;
  readable: boolean;
};

export const BOOK_FORMATS: BookFormat[] = [
  { extension: "epub", label: "EPUB", readable: true },
  { extension: "pdf", label: "PDF", readable: false },
  { extension: "azw3", label: "AZW3", readable: false },
  { extension: "mobi", label: "MOBI", readable: false }
];

export const IMPORTABLE_EXTENSIONS = BOOK_FORMATS.map((format) => format.extension);

export const READABLE_EXTENSIONS = BOOK_FORMATS.filter((format) => format.readable).map(
  (format) => format.extension
);

export const formatDisplayList = (extensions: string[]) =>
  extensions.map((ext) => ext.toUpperCase()).join(", ");

export const getBookExtension = (path: string) =>
  path.split(".").pop()?.toLowerCase() ?? "";

export const isReadableExtension = (extension: string) =>
  READABLE_EXTENSIONS.includes(extension);

export const isImportableExtension = (extension: string) =>
  IMPORTABLE_EXTENSIONS.includes(extension);
