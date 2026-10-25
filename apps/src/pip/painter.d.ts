/** Typed boundary for painter.js: the painter Pip's rooms and pictures are drawn with (for tests that read a picture's pixels). */

export function blend(under: string, over: string): string;

export class Painter {
  constructor(w: number, h: number, f?: number, canvas?: unknown, origin?: [number, number]);
  readonly w: number;
  readonly h: number;
  px(x: number, y: number, c: string): this;
  rect(x: number, y: number, w: number, h: number, c: string): this;
  toImageData(): ImageData;
}
