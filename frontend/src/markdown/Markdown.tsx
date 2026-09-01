import { Fragment, type ReactNode } from 'react';
import styles from './Markdown.module.css';

/**
 * A tiny, dependency-free Markdown renderer for note and summary bodies.
 *
 * The folio build is pinned and offline (see folio-frontend/default.nix), so we
 * avoid pulling in react-markdown & friends. Notes are short prose, so we cover
 * the common subset: headings, bold/italic, inline code, links, fenced &
 * indented code, blockquotes, nested lists, horizontal rules and paragraphs.
 * All output is plain React elements — no dangerouslySetInnerHTML — so user
 * text can never inject markup.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  const lines = children.replace(/\r\n?/g, '\n').split('\n');
  const blocks = parseBlocks(lines);
  return <div className={[styles.md, className].filter(Boolean).join(' ')}>{blocks}</div>;
}

// --- block level -----------------------------------------------------------

const FENCE = /^(\s*)(```|~~~)\s*([^\s`]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])\s*(?:\1\s*){2,}$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

function parseBlocks(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== marker) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      out.push(
        <pre key={k()} className={styles.pre}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as 'h1';
      out.push(<Tag key={k()}>{parseInline(heading[2])}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule.
    if (HR.test(line)) {
      out.push(<hr key={k()} />);
      i++;
      continue;
    }

    // Blockquote: gather consecutive '>'-prefixed lines, then parse recursively.
    if (/^ {0,3}>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i++;
      }
      out.push(<blockquote key={k()}>{parseBlocks(inner)}</blockquote>);
      continue;
    }

    // List (ordered or unordered).
    if (BULLET.test(line) || ORDERED.test(line)) {
      const [list, next] = parseList(lines, i, k);
      out.push(list);
      i = next;
      continue;
    }

    // Paragraph: gather until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(<p key={k()}>{parseInline(para.join('\n'))}</p>);
  }

  return out;
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    /^ {0,3}>/.test(line)
  );
}

/**
 * Parse one list starting at `start`. Items are grouped by their marker type
 * (ordered vs. unordered) and indentation; more-indented lines are collected as
 * an item's children and parsed recursively, giving nested lists.
 */
function parseList(lines: string[], start: number, k: () => string): [ReactNode, number] {
  const first = (BULLET.exec(lines[start]) ?? ORDERED.exec(lines[start]))!;
  const baseIndent = first[1].length;
  const ordered = ORDERED.test(lines[start]);
  const items: ReactNode[] = [];
  let i = start;
  let itemKey = 0;

  while (i < lines.length) {
    const m = BULLET.exec(lines[i]) ?? ORDERED.exec(lines[i]);
    if (!m || m[1].length !== baseIndent || ORDERED.test(lines[i]) !== ordered) break;

    const childLines: string[] = [m[3]];
    const contentIndent = m[0].length - m[3].length;
    i++;
    // Continuation and nested lines belong to this item until the next
    // sibling marker at the same indent or a blank-separated non-indented line.
    while (i < lines.length) {
      if (lines[i].trim() === '') {
        // A blank line stays with the item only if the list continues after it.
        const after = lines[i + 1];
        if (after && (leadingSpaces(after) > baseIndent || isMarkerAt(after, baseIndent, ordered))) {
          childLines.push('');
          i++;
          continue;
        }
        break;
      }
      if (isMarkerAt(lines[i], baseIndent, ordered)) break;
      if (leadingSpaces(lines[i]) >= contentIndent || !startsBlock(lines[i])) {
        childLines.push(lines[i].slice(Math.min(contentIndent, leadingSpaces(lines[i]))));
        i++;
        continue;
      }
      break;
    }
    items.push(<li key={`i${itemKey++}`}>{renderItem(childLines)}</li>);
  }

  const List = ordered ? 'ol' : 'ul';
  return [<List key={k()}>{items}</List>, i];
}

// Render a list item's children. A single simple paragraph is rendered inline
// (no <p> wrapper) so tight lists stay compact; anything richer goes through the
// full block parser (nested lists, multi-paragraph items, code, etc.).
function renderItem(childLines: string[]): ReactNode {
  const trimmed = [...childLines];
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  const simple =
    trimmed.every((l) => l.trim() !== '') && !trimmed.some((l) => startsBlock(l));
  if (simple) return parseInline(trimmed.join('\n'));
  return <Fragment>{parseBlocks(trimmed)}</Fragment>;
}

function leadingSpaces(line: string): number {
  return line.length - line.replace(/^\s+/, '').length;
}

function isMarkerAt(line: string, indent: number, ordered: boolean): boolean {
  const m = BULLET.exec(line) ?? ORDERED.exec(line);
  return !!m && m[1].length === indent && ORDERED.test(line) === ordered;
}

// --- inline level ----------------------------------------------------------

/**
 * Parse inline markup within a run of text. Handled, in priority order: escapes
 * (`\*`), inline code (`` `x` ``), links (`[t](url)`), images (`![alt](url)`),
 * bold (`**` / `__`), italic (`*` / `_`), and hard/soft line breaks. Emphasis
 * content is parsed recursively so bold-in-italic etc. nest correctly.
 */
export function parseInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let key = 0;
  const push = (node: ReactNode) => {
    flush();
    out.push(<Fragment key={`${keyPrefix}${key++}`}>{node}</Fragment>);
  };
  const flush = () => {
    if (buf) {
      out.push(<Fragment key={`${keyPrefix}${key++}`}>{buf}</Fragment>);
      buf = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';

    // Backslash escape of a punctuation char.
    if (ch === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!>~]/.test(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Hard line break: two+ trailing spaces before a newline, or a bare newline.
    if (ch === '\n') {
      push(<br />);
      i++;
      continue;
    }

    // Inline code.
    if (ch === '`') {
      const m = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
      if (m) {
        push(<code className={styles.code}>{m[2].replace(/^ | $/g, '')}</code>);
        i += m[0].length;
        continue;
      }
    }

    // Image: ![alt](url)
    if (ch === '!' && text[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (m) {
        push(<img className={styles.img} src={m[2]} alt={m[1]} />);
        i += m[0].length;
        continue;
      }
    }

    // Link: [text](url)
    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (m) {
        push(
          <a className={styles.link} href={m[2]} target="_blank" rel="noopener noreferrer">
            {parseInline(m[1], `${keyPrefix}${key}l`)}
          </a>,
        );
        i += m[0].length;
        continue;
      }
    }

    // Bold: ** … ** or __ … __
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const marker = rest.slice(0, 2);
      const re = marker === '**' ? /^\*\*([\s\S]+?)\*\*/ : /^__([\s\S]+?)__/;
      const m = re.exec(rest);
      // For `_`, require word boundaries on both ends so snake_case stays literal.
      const ok =
        m && (marker === '**' || (!isWord(prev) && !isWord(text[i + m[0].length])));
      if (m && ok) {
        push(<strong>{parseInline(m[1], `${keyPrefix}${key}b`)}</strong>);
        i += m[0].length;
        continue;
      }
    }

    // Italic: * … * or _ … _
    if (ch === '*' || ch === '_') {
      const re = ch === '*' ? /^\*([^\s*][\s\S]*?)\*/ : /^_([^\s_][\s\S]*?)_/;
      const m = re.exec(rest);
      const ok = m && (ch === '*' || (!isWord(prev) && !isWord(text[i + m[0].length])));
      if (m && ok) {
        push(<em>{parseInline(m[1], `${keyPrefix}${key}e`)}</em>);
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

function isWord(ch: string): boolean {
  return /\w/.test(ch ?? '');
}
