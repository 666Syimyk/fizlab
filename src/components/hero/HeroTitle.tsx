import { useLayoutEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

export function HeroTitle({ text }: { text: string }) {
  const containerRef = useRef<HTMLHeadingElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const letters = containerRef.current.querySelectorAll("[data-letter]");

    if (reducedMotion) {
      gsap.set(letters, { opacity: 1, y: 0 });
      return;
    }

    gsap.fromTo(
      letters,
      { opacity: 0, y: 28, rotateX: -40 },
      {
        opacity: 1,
        y: 0,
        rotateX: 0,
        duration: 0.7,
        ease: "back.out(1.7)",
        stagger: 0.035,
        delay: 0.15,
      },
    );
  }, [reducedMotion]);

  return (
    <h1
      ref={containerRef}
      className="select-none text-5xl font-bold tracking-tight sm:text-7xl"
      style={{ perspective: 600 }}
    >
      {[...text].map((char, i) => (
        <span
          key={i}
          data-letter
          className="inline-block"
          style={{ opacity: reducedMotion ? 1 : 0 }}
        >
          {char === " " ? " " : char}
        </span>
      ))}
    </h1>
  );
}
