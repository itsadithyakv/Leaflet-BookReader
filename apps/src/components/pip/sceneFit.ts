/** The smallest half step: 1.5 device pixels an art pixel (at 1 there is no smaller whole step to add half to). */
const MIN_HALF_STEP = 1.5;

/**
 * How big Pip's house is drawn: device pixels per art pixel, for a floor of
 * `artWidth` by `artHeight` in a box of `boxWidth` by `boxHeight` CSS pixels.
 *
 * Whole steps keep every art pixel the same size, but on their own they leave
 * much of the page empty on a narrow window: at 820 px the room was two
 * pixels a pixel, 480 px across in 680. So half steps count too (1.5, 2.5,
 * 3.5): the art's pixels alternate by one device pixel, which still reads as
 * the same pixel art, and the room fills most of what it is given. Never
 * fewer than one.
 */
export const sceneScale = (artWidth: number, artHeight: number, boxWidth: number, boxHeight: number, ratio = 1) => {
  const exact = Math.min((boxWidth * ratio) / artWidth, (boxHeight * ratio) / artHeight);
  const whole = Math.max(1, Math.floor(exact + 1e-6));
  const half = Math.floor(exact * 2 + 1e-6) / 2;
  return half >= MIN_HALF_STEP ? Math.max(whole, half) : whole;
};
