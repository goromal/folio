import type { Block } from '../api/client';

/**
 * Renders ordered blocks as the DOM contract the whole reader depends on:
 * one element per block carrying data-block-id + data-block-type, containing
 * exactly the block's plain text as a single text node. The character offset
 * into block.text is therefore the DOM Range offset directly (see subsystem B
 * design). B2's paginator reuses this exact markup inside a multicolumn flow.
 */
export function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b) => (
        <p key={b.id} data-block-id={b.id} data-block-type={b.type}>
          {b.text}
        </p>
      ))}
    </>
  );
}
