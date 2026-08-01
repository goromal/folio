import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Paginator } from './Paginator';

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
  // In jsdom scrollWidth/clientWidth are 0 → a single page; controls still render
  // and must not throw when used.
  await userEvent.click(screen.getByRole('button', { name: /next page/i }));
  await userEvent.click(screen.getByRole('button', { name: /previous page/i }));
  expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
});
