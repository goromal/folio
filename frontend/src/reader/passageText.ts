import type { Block } from '../api/client';

/**
 * Resolve a passage's plain text from the book's ordered blocks by slicing from
 * (start_block,start_off) to (end_block,end_off). Cross-block passages join the
 * covered blocks (in order_idx order) with "\n". Returns '' if unresolvable.
 */
export function passageText(
  blocks: Block[],
  p: { start_block: number; start_off: number; end_block: number; end_off: number },
): string {
  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  const start = byId.get(p.start_block);
  const end = byId.get(p.end_block);
  if (!start || !end) return '';
  if (p.start_block === p.end_block) {
    return start.text.slice(p.start_off, p.end_off);
  }
  const ordered = [...blocks].sort((a, b) => a.order_idx - b.order_idx);
  const si = ordered.findIndex((b) => b.id === p.start_block);
  const ei = ordered.findIndex((b) => b.id === p.end_block);
  if (si < 0 || ei < 0 || ei < si) return '';
  const parts: string[] = [];
  for (let i = si; i <= ei; i++) {
    const b = ordered[i];
    const from = i === si ? p.start_off : 0;
    const to = i === ei ? p.end_off : b.text.length;
    parts.push(b.text.slice(from, to));
  }
  return parts.join('\n');
}
