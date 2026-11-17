import { BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { NoteBlock } from "@/types/topic";

export function NotesRenderer({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return (
              <h3 key={i} className="pt-2 font-display text-xl font-semibold first:pt-0">
                {block.content as string}
              </h3>
            );
          case "paragraph":
            return (
              <p key={i} className="leading-relaxed text-muted">
                {block.content as string}
              </p>
            );
          case "formula":
            return (
              <div
                key={i}
                role="region"
                aria-label={`Формула конспекта ${i + 1}`}
                tabIndex={0}
                className="overflow-x-auto rounded-xl border border-border bg-surface-2 px-4 py-3"
              >
                <BlockMath math={block.content as string} />
              </div>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-muted">
                {(block.content as string[]).map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
