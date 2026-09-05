import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Paginator, type PaginatorHandle } from './Paginator';

/** Drag one finger across the viewport from (x0,y0) to (x1,y1). The turn is expected
 * to fire on the move, before the finger lifts. */
function swipe(vp: Element, x0: number, y0: number, x1: number, y1: number) {
  fireEvent.touchStart(vp, { touches: [{ clientX: x0, clientY: y0 }] });
  fireEvent.touchMove(vp, { touches: [{ clientX: x1, clientY: y1 }] });
  fireEvent.touchEnd(vp, { changedTouches: [{ clientX: x1, clientY: y1 }] });
}

/** jsdom reports zero layout, so pageCount would collapse to 1 and no page could turn.
 * Stub a viewport/content size for the duration of `body`. */
function withLayout(clientWidth: number, scrollWidth: number, body: () => void) {
  const sizes = { clientWidth, scrollWidth };
  for (const [prop, value] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
  }
  try {
    body();
  } finally {
    for (const prop of Object.keys(sizes)) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  }
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
  // 400px-wide viewport over 1200px of content -> three pages.
  withLayout(400, 1200, () => {
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
  });
});

test('the page turn fires on the move, without waiting for the finger to lift', () => {
  withLayout(400, 1200, () => {
    const { container } = render(
      <Paginator resetKey={1}>
        <p data-block-id="1" data-block-type="para">hello</p>
      </Paginator>,
    );
    const vp = container.querySelector('[data-folio-flow]')!.parentElement!;
    fireEvent.touchStart(vp, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchMove(vp, { touches: [{ clientX: 100, clientY: 110 }] });
    // No touchEnd yet — the page must already have turned.
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
});

test('one gesture turns at most one page, however far the finger keeps going', () => {
  withLayout(400, 1200, () => {
    const { container } = render(
      <Paginator resetKey={1}>
        <p data-block-id="1" data-block-type="para">hello</p>
      </Paginator>,
    );
    const vp = container.querySelector('[data-folio-flow]')!.parentElement!;
    fireEvent.touchStart(vp, { touches: [{ clientX: 380, clientY: 100 }] });
    for (const x of [280, 180, 80, 10]) {
      fireEvent.touchMove(vp, { touches: [{ clientX: x, clientY: 100 }] });
    }
    fireEvent.touchEnd(vp, { changedTouches: [{ clientX: 10, clientY: 100 }] });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
});

test('re-paginates when the reader text size changes', async () => {
  // Same viewport, but the resized text reflows to twice the content width.
  let scrollWidth = 1200;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  try {
    const { rerender } = render(
      <Paginator resetKey={1} fontSize={18}>
        <p data-block-id="1" data-block-type="para">hello</p>
      </Paginator>,
    );
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    scrollWidth = 2400; // bigger text -> more columns
    rerender(
      <Paginator resetKey={1} fontSize={24}>
        <p data-block-id="1" data-block-type="para">hello</p>
      </Paginator>,
    );
    // The re-measure is deferred one frame (ThemeProvider writes --reader-fs after
    // this child's effects run), so the new total appears asynchronously.
    expect(await screen.findByText('1 / 6')).toBeInTheDocument();
  } finally {
    for (const prop of ['clientWidth', 'scrollWidth']) {
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
