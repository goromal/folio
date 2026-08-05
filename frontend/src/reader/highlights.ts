import { anchorToRange } from './anchors';
import type { PassageDetail } from '../api/client';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'red'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Build a Range per passage (via its stored anchor), grouped by highlight color. */
export function groupRangesByColor(root: ParentNode, passages: PassageDetail[]): Map<string, Range[]> {
  const byColor = new Map<string, Range[]>();
  for (const p of passages) {
    const range = anchorToRange(root, p);
    if (!range) continue;
    // Normalize to the known palette so an off-palette color (e.g. an agent-set color the
    // reader has no ::highlight rule for) still paints instead of being invisible.
    const raw = p.highlights[0]?.color ?? 'yellow';
    const color = (HIGHLIGHT_COLORS as readonly string[]).includes(raw) ? raw : 'yellow';
    const list = byColor.get(color);
    if (list) list.push(range);
    else byColor.set(color, [range]);
  }
  return byColor;
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): HighlightRegistry | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
  return (CSS as unknown as { highlights: HighlightRegistry }).highlights;
}

/**
 * Paint stored passages as CSS custom highlights (no DOM mutation → offsets stay
 * exact). Feature-detected: a no-op where the API is absent (jsdom, old browsers).
 */
export function paintHighlights(root: ParentNode, passages: PassageDetail[]): void {
  const reg = registry();
  if (!reg) return;
  for (const c of HIGHLIGHT_COLORS) reg.delete(`folio-${c}`);
  const HighlightCtor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  for (const [color, ranges] of groupRangesByColor(root, passages)) {
    reg.set(`folio-${color}`, new HighlightCtor(...ranges));
  }
}
