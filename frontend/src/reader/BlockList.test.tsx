import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BlockList } from './BlockList';

test('renders each block with data-block-id and its text', () => {
  const { container } = render(
    <BlockList
      blocks={[
        { id: 10, chapter_id: 1, order_idx: 0, type: 'heading', text: 'Chapter One' },
        { id: 11, chapter_id: 1, order_idx: 1, type: 'para', text: 'The quick brown fox.' },
      ]}
    />,
  );
  const heading = container.querySelector('[data-block-id="10"]')!;
  expect(heading).toHaveAttribute('data-block-type', 'heading');
  expect(heading.textContent).toBe('Chapter One');
  const para = container.querySelector('[data-block-id="11"]')!;
  expect(para.childNodes).toHaveLength(1); // single text node → clean offset mapping
  expect(para.textContent).toBe('The quick brown fox.');
});
