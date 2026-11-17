import type { TopicModule } from "@/types/topic";
import { allTopicsFlat } from "@/data/sections";
import { REAL_TOPIC_SLUGS } from "./manifest";
import { createStub } from "./stub";

// Each topic's index.ts eagerly imports its notes/examples/problems/history, so importing
// all 62 statically (as this file used to) forced them into one shared chunk regardless of
// which page needed them. import.meta.glob keeps each topic's module as its own lazy chunk —
// only the slug actually visited gets fetched.
const topicLoaders = import.meta.glob<Record<string, TopicModule>>("./*/index.ts");

function loaderFor(slug: string) {
  return topicLoaders[`./${slug}/index.ts`];
}

/** True for slugs with real, authored content (see manifest.ts). */
export function hasContent(slug: string): boolean {
  return REAL_TOPIC_SLUGS.has(slug);
}

function stubFor(slug: string): TopicModule | undefined {
  const meta = allTopicsFlat().find((t) => t.slug === slug);
  if (!meta) return undefined;
  return createStub({
    slug: meta.slug,
    title: meta.title,
    sectionId: meta.sectionId,
    summary: "Тема курса общей физики.",
  });
}

/** Loads a topic's full content on demand. Resolves to undefined for an unknown slug. */
export async function loadTopic(slug: string): Promise<TopicModule | undefined> {
  const loader = loaderFor(slug);
  if (!loader) return stubFor(slug);
  const mod = await loader();
  const topic = Object.values(mod)[0];
  return topic ?? stubFor(slug);
}
