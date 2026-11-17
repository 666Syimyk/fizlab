import { InlineMath } from "react-katex";
import "katex/dist/katex.min.css";

/** Renders a string with $...$ segments as inline KaTeX math, rest as plain text. */
export function MathText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("$") && part.endsWith("$") && part.length > 1 ? (
          <InlineMath key={i} math={part.slice(1, -1)} />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
