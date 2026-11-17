import { Link, Navigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, History as HistoryIcon, Lock, Sparkles } from "lucide-react";
import { findSection } from "@/data/sections";
import { REAL_TOPIC_SLUGS } from "@/topics/manifest";
import { contentIndex } from "@/data/contentIndex";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSolvedCount } from "@/hooks/useProgress";
import { useAccess } from "@/hooks/useAccess";
import { ALL_TOPICS_FREE, isFreeDemoTopic } from "@/lib/access";

function ProblemsBadge({ slug }: { slug: string }) {
  const solved = useSolvedCount(slug);
  const total = contentIndex[slug]?.problemCount ?? 0;
  if (total === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        solved >= total
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-transparent text-muted-2",
      )}
    >
      решено {solved}/{total}
    </span>
  );
}

function ReadinessDot({ ready, icon: Icon, label }: { ready: boolean; icon: typeof BookOpen; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        ready
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-transparent text-muted-2",
      )}
      title={label}
    >
      <Icon className="h-3 w-3" />
      {ready ? label : "скоро"}
    </span>
  );
}

export function SectionPage() {
  const { sectionId = "" } = useParams();
  const section = findSection(sectionId);
  const { hasFullAccess } = useAccess();

  useDocumentTitle(section?.title);

  if (!section) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: section.title }]} />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10"
      >
        <h1 className="mb-2 text-3xl font-bold tracking-tight">{section.title}</h1>
        <p className="text-muted">{section.description}</p>
      </motion.div>

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/60">
        {section.topics.map((topic, i) => {
          const ready = REAL_TOPIC_SLUGS.has(topic.slug);
          const notesReady = ready;
          const historyReady = ready;
          const simReady = ready;
          const locked = !isFreeDemoTopic(topic.slug) && !hasFullAccess;

          return (
            <li key={topic.slug}>
              <Link
                to={`/topic/${topic.slug}`}
                className="group flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-2">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-foreground">{topic.title}</span>
                  {locked && (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-2" aria-label="Доступ по подписке" />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pl-8 sm:justify-end sm:pl-0">
                  {!ALL_TOPICS_FREE && isFreeDemoTopic(topic.slug) && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">Бесплатно</span>}
                  <ReadinessDot ready={notesReady} icon={BookOpen} label="конспект" />
                  <ReadinessDot ready={historyReady} icon={HistoryIcon} label="история" />
                  <ReadinessDot ready={simReady} icon={Sparkles} label="симуляция" />
                  <ProblemsBadge slug={topic.slug} />
                  <ArrowRight className="ml-1 h-4 w-4 shrink-0 text-muted-2 transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
