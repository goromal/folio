import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Paginator, type PaginatorHandle } from './Paginator';

/** Drag one finger across the viewport from (x0,y0) to (x1,y1). */
function swipe(vp: Element, x0: number, y0: number, x1: number, y1: number) {
  fireEvent.touchStart(vp, { touches: [{ clientX: x0, clientY: y0 }] });
  fireEvent.touchEnd(vp, { changedTouches: [{ clientX: x1, clientY: y1 }] });
}

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

test('swiping across the viewport turns pages', () => {
  // jsdom reports zero layout, so pageCount collapses to 1 and no page can turn.
  // Stub a 400px-wide viewport over 1200px of content -> three pages.
  const sizes = { clientWidth: 400, scrollWidth: 1200 };
  for (const [prop, value] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
  }
  try {
    const { container } = render(
      <Paginator resetKey={1}>
        <p data-block-id="1" data-block-type="para">hello</p>
      </Paginator>,
    );
    const vp = container.querySelector('[data-folio-flow]')!.parentElement!;
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    swipe(vp, 300, 100, 100, 110); // leftward -> next page
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    swipe(vp, 100, 100, 300, 110); // rightward -> previous page
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    swipe(vp, 300, 100, 280, 300); // short and mostly vertical -> not a page turn
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  } finally {
    for (const prop of Object.keys(sizes)) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  }
});

test('does not report a page block on initial render (only user page turns report)', () => {
  const onPageBlock = vi.fn();
  render(
    <Paginator resetKey={0} onPageBlock={onPageBlock}>
      <p data-block-id="7" data-block-type="para">hello</p>
    </Paginator>,
  );
  // A programmatic/initial render must NOT report — otherwise a restore jump would
  // clobber the saved position. Reporting is driven only by user page turns (go()).
  expect(onPageBlock).not.toHaveBeenCalled();
});
