import type { Block } from '../api/client';

/**
 * Renders ordered blocks as the reader DOM contract: one element per block
 * carrying data-block-id + data-block-type, a single text node (offsets map
 * directly onto stored anchors). `flashBlockId` briefly outlines a block that
 * the agent's view-follow just jumped to.
 */
export function BlockList({
  blocks,
  flashBlockId,
}: {
  blocks: Block[];
  flashBlockId?: number | null;
}) {
  return (
    <>
      {blocks.map((b) => (
        <p
          key={b.id}
          data-block-id={b.id}
          data-block-type={b.type}
          style={
            b.id === flashBlockId
              ? { outline: '2px solid var(--accent)', outlineOffset: '2px' }
              : undefined
          }
        >
          {b.text}
        </p>
      ))}
    </>
  );
}
