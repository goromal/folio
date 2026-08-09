export interface PassageAnchor {
  start_block: number;
  start_off: number;
  end_block: number;
  end_off: number;
}

function blockElement(node: Node): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('[data-block-id]') ?? null;
}

/** Character offset within `blockEl` for a (node, offsetInNode) DOM position. */
function charOffset(blockEl: Element, node: Node, offsetInNode: number): number {
  if (node.nodeType === Node.ELEMENT_NODE) {
    // Element container: offset is a child index. For our single-text-node blocks
    // this is 0 (before text) or 1 (after) — map to 0 or full length.
    const len = (blockEl.textContent ?? '').length;
    return offsetInNode === 0 ? 0 : len;
  }
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return total + offsetInNode;
    total += (n.textContent ?? '').length;
  }
  return Math.min(offsetInNode, total);
}

function locate(node: Node, offset: number): { block: number; off: number } | null {
  const blockEl = blockElement(node);
  if (!blockEl) return null;
  return { block: Number(blockEl.getAttribute('data-block-id')), off: charOffset(blockEl, node, offset) };
}

/**
 * Map a DOM Range (already in document order — a real Selection guarantees it)
 * to a passage anchor. Returns null for a collapsed selection or a selection
 * that isn't inside any `[data-block-id]` element.
 */
export function rangeToAnchor(range: Range): PassageAnchor | null {
  const start = locate(range.startContainer, range.startOffset);
  const end = locate(range.endContainer, range.endOffset);
  if (!start || !end) return null;
  if (start.block === end.block && start.off === end.off) return null; // collapsed
  return { start_block: start.block, start_off: start.off, end_block: end.block, end_off: end.off };
}

/** Find the text node + in-node offset for character index `charOff` in `blockEl`.
 * An offset past the block's end clamps to the end of the last text node, so an
 * out-of-bounds anchor (e.g. an agent using a large end_off to mean "to end of block")
 * still resolves instead of dropping the whole highlight. */
function textPoint(blockEl: Element, charOff: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (!first) return null; // empty block — nothing to attach to
  let remaining = charOff;
  let last: Node = first;
  for (let n: Node | null = first; n; n = walker.nextNode()) {
    last = n;
    const len = (n.textContent ?? '').length;
    if (remaining <= len) return { node: n, offset: remaining };
    remaining -= len;
  }
  return { node: last, offset: (last.textContent ?? '').length };
}

/** Rebuild a Range for a stored anchor within `root`. Returns null if unresolvable. */
export function anchorToRange(root: ParentNode, anchor: PassageAnchor): Range | null {
  const startEl = root.querySelector(`[data-block-id="${anchor.start_block}"]`);
  const endEl = root.querySelector(`[data-block-id="${anchor.end_block}"]`);
  if (!startEl || !endEl) return null;
  const start = textPoint(startEl, anchor.start_off);
  const end = textPoint(endEl, anchor.end_off);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}
