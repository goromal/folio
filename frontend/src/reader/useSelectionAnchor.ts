import { useEffect, useState, type RefObject } from 'react';
import { rangeToAnchor, type PassageAnchor } from './anchors';

export interface SelectionState {
  anchor: PassageAnchor;
  rect: Pick<DOMRect, 'top' | 'left'>;
}

/** Track a live, non-collapsed selection inside `rootRef` as a passage anchor + screen rect. */
export function useSelectionAnchor(rootRef: RefObject<HTMLElement>): SelectionState | null {
  const [sel, setSel] = useState<SelectionState | null>(null);
  useEffect(() => {
    function onChange() {
      const selection = window.getSelection();
      const root = rootRef.current;
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !root) {
        setSel(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setSel(null);
        return;
      }
      const anchor = rangeToAnchor(range);
      if (!anchor) {
        setSel(null);
        return;
      }
      const r = range.getBoundingClientRect();
      setSel({ anchor, rect: { top: r.top, left: r.left } });
    }
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [rootRef]);
  return sel;
}
