import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/useAccess";
import { ALL_TOPICS_FREE, FREE_DEMO_SLUGS } from "@/lib/access";
import { HeroTitle } from "./HeroTitle";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePrefersReducedMotion, useIsMobile } from "@/hooks/useMediaQuery";

const HeroCanvas = lazy(() =>
  import("./HeroCanvas").then((m) => ({ default: m.HeroCanvas })),
);

export function Hero() {
  const { hasFullAccess } = useAccess();
  const reducedMotion = usePrefersReducedMotion();
  const mobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative flex h-[100svh] w-full items-center justify-center overflow-hidden">
      <div className="absolute inset-0">
        {/* CSS-only placeholder: paints instantly, before the three.js chunk
            (~340KB gzipped) has even started downloading. Swapped for the
            real 3D scene as soon as it's ready — no layout shift since both
            fill the same absolutely-positioned container. */}
        <ErrorBoundary fallback={<div aria-hidden="true" className="h-full w-full bg-[radial-gradient(ellipse_at_center,var(--color-surface-2),transparent)]" />}>
        <Suspense
          fallback={
            <div
              className="h-full w-full opacity-70"
              style={{
                background:
                  "radial-gradient(60% 50% at 50% 45%, color-mix(in oklab, var(--color-accent) 18%, transparent), transparent 70%)",
              }}
              aria-hidden
            />
          }
        >
          <HeroCanvas reducedMotion={reducedMotion} mobile={mobile} active={visible} />
        </Suspense>
        </ErrorBoundary>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 45%, color-mix(in oklab, var(--color-background) 55%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6 px-4 text-center">
        <motion.span
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="rounded-full border border-border bg-surface/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur-sm"
        >
          Курс общей физики · 3D-симуляции
        </motion.span>

        <HeroTitle text="ФизЛаб 3D" />

        <motion.p
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="max-w-xl text-balance text-lg leading-relaxed text-muted"
        >
          Интерактивный учебник физики: честная 3D-физика, формулы и задачи с
          автопроверкой — по каждой теме курса.
        </motion.p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="accent"><Link to="/topic/kinematics">Попробовать бесплатно</Link></Button>
          <Button asChild variant="outline"><Link to="/subscription">{hasFullAccess ? "Моя подписка" : "Открыть полный курс"}</Link></Button>
        </div>
        <p className="max-w-md text-sm text-muted">{ALL_TOPICS_FREE ? "Все темы сейчас открыты бесплатно." : `${FREE_DEMO_SLUGS.size} бесплатных тем. Полный доступ — по подписке на месяц или год.`}</p>
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1 }}
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-xs text-muted-2"
      >
        <span>Прокрутите вниз</span>
        <motion.span
          animate={reducedMotion ? {} : { y: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="h-8 w-px bg-gradient-to-b from-muted-2 to-transparent"
        />
      </motion.div>
    </section>
  );
}
