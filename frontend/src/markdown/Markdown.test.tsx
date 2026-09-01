import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Markdown } from './Markdown';

function html(md: string): string {
  const { container } = render(<Markdown>{md}</Markdown>);
  return (container.firstChild as HTMLElement).innerHTML;
}

test('renders bold, italic and inline code', () => {
  const out = html('This is **bold**, *italic* and `code`.');
  expect(out).toContain('<strong>bold</strong>');
  expect(out).toContain('<em>italic</em>');
  expect(out).toContain('<code');
  expect(screen.getByText('code').tagName).toBe('CODE');
});

test('renders links with safe attributes', () => {
  render(<Markdown>{'See [the docs](https://example.com/x).'}</Markdown>);
  const a = screen.getByRole('link', { name: 'the docs' });
  expect(a).toHaveAttribute('href', 'https://example.com/x');
  expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  expect(a).toHaveAttribute('target', '_blank');
});

test('renders headings', () => {
  render(<Markdown>{'# Title\n\nbody'}</Markdown>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title');
});

test('renders unordered and ordered lists', () => {
  const { container } = render(<Markdown>{'- one\n- two\n\n1. first\n2. second'}</Markdown>);
  expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  const ol = container.querySelector('ol');
  expect(ol?.querySelectorAll('li')).toHaveLength(2);
  expect(screen.getByText('second')).toBeInTheDocument();
});

test('renders nested lists', () => {
  const { container } = render(<Markdown>{'- parent\n  - child\n  - child2'}</Markdown>);
  const nested = container.querySelector('li > ul');
  expect(nested).not.toBeNull();
  expect(nested?.querySelectorAll('li')).toHaveLength(2);
});

test('renders fenced code blocks verbatim', () => {
  const { container } = render(<Markdown>{'```\nconst x = **not bold**;\n```'}</Markdown>);
  const pre = container.querySelector('pre > code');
  expect(pre?.textContent).toBe('const x = **not bold**;');
  expect(container.querySelector('strong')).toBeNull();
});

test('renders blockquotes', () => {
  const { container } = render(<Markdown>{'> quoted line\n> still quoted'}</Markdown>);
  expect(container.querySelector('blockquote')).not.toBeNull();
  expect(screen.getByText(/quoted line/)).toBeInTheDocument();
});

test('renders a horizontal rule', () => {
  const { container } = render(<Markdown>{'above\n\n---\n\nbelow'}</Markdown>);
  expect(container.querySelector('hr')).not.toBeNull();
});

test('does not italicize intra-word underscores', () => {
  const { container } = render(<Markdown>{'call some_function_name here'}</Markdown>);
  expect(container.querySelector('em')).toBeNull();
  expect(screen.getByText(/some_function_name/)).toBeInTheDocument();
});

test('does not inject raw HTML', () => {
  const out = html('<img src=x onerror=alert(1)> & <b>hi</b>');
  expect(out).not.toContain('<img src=x');
  expect(out).toContain('&lt;img');
  expect(out).toContain('&lt;b&gt;hi&lt;/b&gt;');
});

test('honors backslash escapes', () => {
  const { container } = render(<Markdown>{'not \\*emphasized\\*'}</Markdown>);
  expect(container.querySelector('em')).toBeNull();
  expect(screen.getByText('not *emphasized*')).toBeInTheDocument();
});

test('preserves single newlines as line breaks', () => {
  const { container } = render(<Markdown>{'line one\nline two'}</Markdown>);
  expect(container.querySelectorAll('br')).toHaveLength(1);
});
