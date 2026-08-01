import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Paginator, type PaginatorHandle } from './Paginator';

test('renders children inside the flow root', () => {
  const { container } = render(
    <Paginator resetKey={1}>
      <p data-block-id="1" data-block-type="para">hello</p>
    </Paginator>,
  );
  const flow = container.querySelector('[data-folio-flow]')!;
  expect(flow).toBeInTheDocument();
  expect(flow.querySelector('[data-block-id="1"]')!.textContent).toBe('hello');
});

test('exposes prev/next controls without throwing on click', async () => {
  render(
    <Paginator resetKey={1}>
      <p data-block-id="1" data-block-type="para">hello</p>
    </Paginator>,
  );
  await userEvent.click(screen.getByRole('button', { name: /next page/i }));
  await userEvent.click(screen.getByRole('button', { name: /previous page/i }));
  expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
});

test('exposes a goToBlock handle that is safe in jsdom', () => {
  const ref = createRef<PaginatorHandle>();
  render(
    <Paginator ref={ref} resetKey={1}>
      <p data-block-id="1" data-block-type="para">hi</p>
    </Paginator>,
  );
  expect(ref.current).not.toBeNull();
  expect(() => ref.current!.goToBlock(1)).not.toThrow();
});
