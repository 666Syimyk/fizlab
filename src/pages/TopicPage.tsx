import { Suspense, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, CheckCircle2, History as HistoryIcon, ListChecks, ScrollText, Sparkles } from "lucide-react";
import { loadTopic } from "@/topics";
import { findSectionByTopicSlug } from "@/data/sections";
import { scientists as scientistsRegistry } from "@/data/scientists";
import type { Scientist, TopicModule } from "@/types/topic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotesRenderer } from "@/components/NotesRenderer";
import { MathText } from "@/components/MathText";
import { SelfCheckProblem } from "@/components/quiz/SelfCheckProblem";
import { ScientistCard } from "@/components/ScientistCard";
import { ScrollReveal } from "@/components/ScrollReveal";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ComingSoon } from "@/components/ComingSoon";
import { SimSkeleton } from "@/components/skeletons/SimSkeleton";
import { TopicPageSkeleton } from "@/components/skeletons/TopicPageSkeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSolvedCount, useTopicCompleted } from "@/hooks/useProgress";
import { setTopicCompleted } from "@/lib/progress";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/useAccess";
import { isFreeDemoTopic } from "@/lib/access";
import { logEvent } from "@/lib/analytics";
import { LockedTopicScreen } from "@/components/LockedTopicScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function TopicPage() {
  const { slug = "" } = useParams();
  const section = findSectionByTopicSlug(slug);
  const [topic, setTopic] = useState<TopicModule | null | undefined>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { hasFullAccess, loading: accessLoading } = useAccess();
  const isFree = isFreeDemoTopic(slug);
  const contentUnlocked = isFree || (!accessLoading && hasFullAccess);
  const topicTitle = section?.topics.find((candidate) => candidate.slug === slug)?.title;

  useEffect(() => {
    let cancelled = false;
    setTopic(null);
    setLoadFailed(false);
    if (!contentUnlocked) return;
    loadTopic(slug).then((t) => {
      if (!cancelled) setTopic(t ?? undefined);
    }).catch(() => {
      if (!cancelled) setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, loadAttempt, contentUnlocked]);

  useDocumentTitle(topicTitle);
  const solvedCount = useSolvedCount(slug);
  const completed = useTopicCompleted(slug);
  const { user } = useAuth();

  useEffect(() => {
    if (topic?.meta.slug === slug && (isFree || (!accessLoading && contentUnlocked))) {
      logEvent("topic_opened", slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, topic, isFree, accessLoading, contentUnlocked]);

  if (!section) return <Navigate to="/" replace />;
  if (!isFree && accessLoading) return <TopicPageSkeleton />;
  if (!contentUnlocked) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <Breadcrumbs
          items={[
            { label: "Главная", to: "/" },
            { label: section.title, to: `/section/${section.id}` },
            { label: topicTitle ?? "Тема" },
          ]}
        />
        <h1 className="mb-6 mt-6 text-3xl font-bold tracking-tight">{topicTitle}</h1>
        <LockedTopicScreen />
      </div>
    );
  }
  if (loadFailed) {
    return (
      <div role="alert" className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
        <h1 className="mb-3 text-2xl font-semibold">Не удалось загрузить тему</h1>
        <p className="mb-5 text-muted">Проверьте подключение к интернету и повторите загрузку.</p>
        <Button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Повторить загрузку</Button>
      </div>
    );
  }
  if (topic === null) return <TopicPageSkeleton />;
  if (!topic) return <Navigate to="/" replace />;
  if (topic.meta.slug !== slug) return <TopicPageSkeleton />;

  const { Sim, examples, problems } = topic;
  const topicScientists = (topic.history.scientists ?? [])
    .map((s) => scientistsRegistry[s])
    .filter((s): s is Scientist => Boolean(s));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <Breadcrumbs
        items={[
          { label: "Главная", to: "/" },
          { label: section.title, to: `/section/${section.id}` },
          { label: topic.meta.title },
        ]}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <h1 className="mb-2 text-3xl font-bold tracking-tight">{topic.meta.title}</h1>
        <p className="text-muted">{topic.meta.summary}</p>
        {user && (
          <Button type="button" variant={completed ? "outline" : "accent"} className="mt-5" onClick={() => setTopicCompleted(slug, !completed)}>
            <CheckCircle2 className="h-4 w-4" />
            {completed ? "Изучено — отменить отметку" : "Отметить тему изученной"}
          </Button>
        )}
      </motion.div>

      <Tabs
        key={slug}
        defaultValue="notes"
        onValueChange={(value) => {
          if (value === "sim") logEvent("sim_started", slug);
        }}
      >
        <TabsList>
          <TabsTrigger value="sim">
            <Sparkles className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">3D-симуляция</span>
          </TabsTrigger>
          <TabsTrigger value="notes">
            <BookOpen className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Конспект</span>
          </TabsTrigger>
          <TabsTrigger value="examples">
            <ScrollText className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Примеры</span>
          </TabsTrigger>
          <TabsTrigger value="self-check">
            <ListChecks className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Проверь себя</span>
            {problems && problems.length > 0 && (
              <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-2">
                {solvedCount}/{problems.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <HistoryIcon className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">История</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sim" className={Sim ? undefined : "h-[520px]"}>
          {Sim ? (
            <ErrorBoundary resetKey={slug} title="Не удалось открыть симуляцию" description="Обновите страницу и попробуйте ещё раз. Конспект, примеры и задачи доступны в соседних вкладках.">
              <Suspense fallback={<SimSkeleton />}>
                <Sim />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <ComingSoon icon={Sparkles} text="Симуляция скоро появится здесь." />
          )}
        </TabsContent>

        <TabsContent value="notes">
          <div className="rounded-2xl border border-border bg-surface/60 p-6 sm:p-8">
            <NotesRenderer blocks={topic.notes} />
          </div>
        </TabsContent>

        <TabsContent value="examples" className="flex flex-col gap-4">
          {examples && examples.length > 0 ? (
            examples.map((example, i) => (
              <div key={i} className="rounded-2xl border border-border bg-surface/60 p-5 sm:p-6">
                <h3 className="mb-2 font-display font-semibold">{example.title}</h3>
                <p className="mb-3 text-sm leading-relaxed text-muted">
                  <MathText text={example.problem} />
                </p>
                {(example.given?.length || example.find) && (
                  <div className="mb-3 grid gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm sm:grid-cols-2">
                    {example.given && example.given.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">Дано</p>
                        <ul className="space-y-0.5 text-muted">
                          {example.given.map((line, j) => (
                            <li key={j}>
                              <MathText text={line} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {example.find && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">Найти</p>
                        <p className="text-muted">
                          <MathText text={example.find} />
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <ol className="space-y-1.5 border-l-2 border-accent/30 pl-3 text-sm leading-relaxed text-muted">
                  {example.solution.map((step, j) => (
                    <li key={j}>
                      <MathText text={step} />
                    </li>
                  ))}
                </ol>
                {example.answer && (
                  <p className="mt-3 text-sm font-medium text-accent">
                    Ответ: <MathText text={example.answer} />
                  </p>
                )}
                {example.note && (
                  <p className="mt-3 rounded-lg bg-accent-2/10 px-3 py-2 text-xs leading-relaxed text-muted">
                    <span className="font-semibold text-accent-2">На что обратить внимание: </span>
                    <MathText text={example.note} />
                  </p>
                )}
              </div>
            ))
          ) : (
            <ComingSoon icon={ScrollText} text="Разобранные примеры скоро появятся здесь." />
          )}
        </TabsContent>

        <TabsContent value="self-check" className="flex flex-col gap-4">
          {problems && problems.length > 0 ? (
            problems.map((problem, i) => (
              <SelfCheckProblem key={problem.id} problem={problem} index={i} slug={slug} />
            ))
          ) : (
            <ComingSoon icon={ListChecks} text="Задачи с автопроверкой скоро появятся здесь." />
          )}
        </TabsContent>

        <TabsContent value="history">
          <div className="rounded-2xl border border-border bg-surface/60 p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent">
                {topic.history.discoverer}
              </span>
              <span className="text-sm text-muted">{topic.history.year}</span>
            </div>

            {topicScientists.length > 0 && (
              <ScrollReveal className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {topicScientists.map((s) => (
                  <ScientistCard key={s.photo} scientist={s} />
                ))}
              </ScrollReveal>
            )}

            {topic.history.rival && (
              <div className="mb-6 rounded-xl border border-border bg-surface-2 p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
                  Научный оппонент: {topic.history.rival}
                </p>
                <p className="text-sm leading-relaxed text-muted">{topic.history.rivalText}</p>
              </div>
            )}

            <ul className="space-y-4">
              {topic.history.facts.map((fact, i) => (
                <li key={i} className="flex gap-4">
                  <div className="w-14 shrink-0 pt-0.5 text-right font-mono text-xs text-muted-2">
                    {fact.year}
                  </div>
                  <div className="border-l border-border pl-4">
                    <p className="mb-1 font-medium">{fact.title}</p>
                    <p className="text-sm leading-relaxed text-muted">{fact.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
