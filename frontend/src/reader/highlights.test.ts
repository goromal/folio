import { expect, test } from 'vitest';
import { groupRangesByColor, paintHighlights } from './highlights';
import type { PassageDetail } from '../api/client';

// Pure-DOM tests — no React needed; keep this file .ts (no JSX).
function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const DOC =
  '<p data-block-id="11" data-block-type="para">The quick brown fox.</p>';

function passage(over: Partial<PassageDetail>): PassageDetail {
  return {
    id: 1, book_id: 7, start_block: 11, start_off: 0, end_block: 11, end_off: 3,
    highlights: [{ id: 1, color: 'green' }], notes: [], tags: [], ...over,
  };
}

test('groups resolvable passages by their highlight color', () => {
  const root = mount(DOC);
  const map = groupRangesByColor(root, [passage({})]);
  expect(map.get('green')!.length).toBe(1);
  expect(map.get('green')![0].toString()).toBe('The');
});

test('defaults to yellow when a passage has no highlight row', () => {
  const root = mount(DOC);
  const map = groupRangesByColor(root, [passage({ highlights: [] })]);
  expect(map.has('yellow')).toBe(true);
});

test('groups a red highlight under red (red is in the palette)', () => {
  const root = mount(DOC);
  const map = groupRangesByColor(root, [passage({ highlights: [{ id: 1, color: 'red' }] })]);
  expect(map.get('red')!.length).toBe(1);
});

test('normalizes an off-palette color to yellow so it still paints', () => {
  const root = mount(DOC);
  const map = groupRangesByColor(root, [passage({ highlights: [{ id: 1, color: 'chartreuse' }] })]);
  expect(map.has('chartreuse')).toBe(false);
  expect(map.get('yellow')!.length).toBe(1);
});

test('skips passages whose anchor cannot be resolved', () => {
  const root = mount(DOC);
  const map = groupRangesByColor(root, [passage({ start_block: 999, end_block: 999 })]);
  expect(map.size).toBe(0);
});

test('paintHighlights is a safe no-op without CSS.highlights (jsdom)', () => {
  const root = mount(DOC);
  expect(() => paintHighlights(root, [passage({})])).not.toThrow();
});
