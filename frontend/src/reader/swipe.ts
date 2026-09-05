export interface SwipeGesture {
  /** Horizontal travel, end minus start (px). Negative = finger moved left. */
  dx: number;
  /** Vertical travel, end minus start (px). */
  dy: number;
  /** Gesture duration (ms). */
  dt: number;
}

export interface SwipeLimits {
  /** Minimum horizontal travel to count as a swipe (px). */
  minDistance: number;
  /** Longest gesture still treated as a swipe (ms). Slower drags are a text
   * selection or a stray finger rest, not a page turn. */
  maxDuration?: number;
}

/** Distance a finger must travel to turn a page, scaled to the page width so the
 * gesture feels the same on a phone and on a tablet. Clamped at both ends: a very
 * narrow (or unmeasured, e.g. jsdom) viewport still needs a deliberate movement, and
 * a wide one never demands more than a comfortable thumb flick. */
export function swipeThreshold(width: number): number {
  return Math.min(80, Math.max(40, width * 0.15));
}

/** Page delta for a finished touch gesture: +1 (next) for a leftward swipe,
 * -1 (previous) for a rightward one, 0 when the gesture isn't a page turn.
 * Requires horizontal dominance so vertical scrolling never turns a page. */
export function swipePageDelta(g: SwipeGesture, limits: SwipeLimits): number {
  const { minDistance, maxDuration = 800 } = limits;
  if (g.dt > maxDuration) return 0;
  if (Math.abs(g.dx) < minDistance) return 0;
  if (Math.abs(g.dx) < Math.abs(g.dy) * 1.5) return 0;
  return g.dx < 0 ? 1 : -1;
}
