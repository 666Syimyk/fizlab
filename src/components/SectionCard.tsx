import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { Section } from "@/data/sections";
import { contentIndex } from "@/data/contentIndex";
import { sectionIcons } from "@/lib/icons";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useSectionSolvedCount } from "@/hooks/useProgress";

export function SectionCard({ section, index }: { section: Section; index: number }) {
  const Icon = sectionIcons[section.icon] ?? sectionIcons.Orbit;
  const reducedMotion = usePrefersReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);

  const slugs = section.topics.map((t) => t.slug);
  const totalProblems = slugs.reduce((sum, s) => sum + (contentIndex[s]?.problemCount ?? 0), 0);
  const solvedProblems = useSectionSolvedCount(slugs);

  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);
  const springConfig = { stiffness: 220, damping: 20 };
  const rotateX = useSpring(useTransform(mouseY, [0, 1], [7, -7]), springConfig);
  const rotateY = useSpring(useTransform(mouseX, [0, 1], [-7, 7]), springConfig);
  const glowX = useTransform(mouseX, [0, 1], ["0%", "100%"]);
  const glowY = useTransform(mouseY, [0, 1], ["0%", "100%"]);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reducedMotion || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width);
    mouseY.set((e.clientY - rect.top) / rect.height);
  }

  function handleMouseLeave() {
    mouseX.set(0.5);
    mouseY.set(0.5);
  }

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={reducedMotion ? undefined : { y: -4 }}
      style={
        reducedMotion
          ? undefined
          : { rotateX, rotateY, transformPerspective: 800 }
      }
      className="h-full"
    >
      <Link
        to={`/section/${section.id}`}
        className="group relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-surface/60 p-6 transition-colors duration-300 hover:border-accent/40"
      >
        <motion.div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: reducedMotion
              ? undefined
              : `radial-gradient(180px circle at ${glowX} ${glowY}, color-mix(in oklab, var(--color-accent) 18%, transparent), transparent 70%)`,
          }}
          aria-hidden
        />

        <motion.div
          className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors group-hover:bg-accent/20"
          animate={reducedMotion ? undefined : { y: [0, -5, 0] }}
          transition={
            reducedMotion
              ? undefined
              : { duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: index * 0.15 }
          }
        >
          <Icon className="h-5 w-5" />
        </motion.div>

        <div className="relative flex flex-1 flex-col gap-1.5">
          <h3 className="font-display text-lg font-semibold">{section.title}</h3>
          <p className="text-sm leading-relaxed text-muted">{section.description}</p>
        </div>

        <div className="relative flex items-center justify-between text-xs text-muted-2">
          <span>
            {section.topics.length} тем
            {solvedProblems > 0 && ` · решено ${solvedProblems}/${totalProblems}`}
          </span>
          <ArrowUpRight className="h-4 w-4 -translate-x-1 translate-y-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" />
        </div>
      </Link>
    </motion.div>
  );
}
