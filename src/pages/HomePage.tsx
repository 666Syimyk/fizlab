import { sections } from "@/data/sections";
import { contentIndex } from "@/data/contentIndex";
import { SectionCard } from "@/components/SectionCard";
import { Hero } from "@/components/hero/Hero";
import { ScrollReveal } from "@/components/ScrollReveal";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useTotalSolvedCount } from "@/hooks/useProgress";
import { Link } from "react-router-dom";

export function HomePage() {
  useDocumentTitle();
  const topicsCount = sections.reduce((sum, s) => sum + s.topics.length, 0);
  // Every topic in the course currently ships with a 3D simulation, so this
  // reuses the lightweight `sections` count instead of importing the full
  // `@/topics` registry (which would pull in every topic's notes/examples/
  // problems text just to show a number on the homepage hero).
  const simsCount = topicsCount;

  const totalProblems = Object.values(contentIndex).reduce((sum, e) => sum + e.problemCount, 0);
  const solvedProblems = useTotalSolvedCount();
  const progressPct = totalProblems > 0 ? Math.round((solvedProblems / totalProblems) * 100) : 0;

  return (
    <div>
      <Hero />

      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <ScrollReveal
          className="mx-auto mb-14 flex max-w-md flex-wrap items-center justify-center gap-x-10 gap-y-4 text-center"
          stagger={0.12}
        >
          <div>
            <div className="font-display text-3xl font-bold text-accent">
              <AnimatedCounter value={sections.length} />
            </div>
            <div className="text-sm text-muted">разделов</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold text-accent">
              <AnimatedCounter value={topicsCount} />
            </div>
            <div className="text-sm text-muted">тем</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold text-accent">
              <AnimatedCounter value={simsCount} />
            </div>
            <div className="text-sm text-muted">с 3D-симуляцией</div>
          </div>
        </ScrollReveal>

        {solvedProblems > 0 && (
          <ScrollReveal className="mx-auto mb-14 max-w-md">
            <div className="rounded-2xl border border-border bg-surface/60 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Ваш прогресс по курсу</span>
                <span className="text-muted-2">
                  {solvedProblems}/{totalProblems} задач
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Решённые задачи курса" aria-valuenow={solvedProblems} aria-valuemin={0} aria-valuemax={totalProblems}>
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </ScrollReveal>
        )}

        <ScrollReveal
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          stagger={0.08}
        >
          {sections.map((section, i) => (
            <SectionCard key={section.id} section={section} index={i} />
          ))}
        </ScrollReveal>
        <footer className="mt-14 flex flex-wrap justify-center gap-x-6 gap-y-3 border-t border-border pt-6 text-sm text-muted">
          <Link to="/subscription" className="hover:text-accent">Подписка</Link>
          <Link to="/terms" className="hover:text-accent">Условия использования</Link>
          <Link to="/privacy" className="hover:text-accent">Конфиденциальность</Link>
        </footer>
      </div>
    </div>
  );
}
