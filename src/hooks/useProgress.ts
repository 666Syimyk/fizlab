import { useCallback, useSyncExternalStore } from "react";
import { getCompletedTopicSlugs, isTopicCompleted, getSolvedCount, getTotalSolvedCount, subscribeToProgress } from "@/lib/progress";

/** Number of solved problems for one topic; re-renders when progress changes anywhere in the app. */
export function useSolvedCount(slug: string): number {
  const getSnapshot = useCallback(() => getSolvedCount(slug), [slug]);
  return useSyncExternalStore(subscribeToProgress, getSnapshot);
}

/** Total solved problems across the whole course; re-renders when progress changes anywhere. */
export function useTotalSolvedCount(): number {
  return useSyncExternalStore(subscribeToProgress, getTotalSolvedCount);
}

export function useTopicCompleted(slug: string): boolean {
  const getSnapshot = useCallback(() => isTopicCompleted(slug), [slug]);
  return useSyncExternalStore(subscribeToProgress, getSnapshot);
}

export function useCompletedTopicSlugs(): string[] {
  const snapshot = useSyncExternalStore(subscribeToProgress, () => getCompletedTopicSlugs().sort().join("|"));
  return snapshot ? snapshot.split("|") : [];
}

/** Solved problems summed across a fixed set of topic slugs (e.g. one section). */
export function useSectionSolvedCount(slugs: string[]): number {
  const key = slugs.join(",");
  const getSnapshot = useCallback(() => key ? key.split(",").reduce((sum, slug) => sum + getSolvedCount(slug), 0) : 0, [key]);
  return useSyncExternalStore(subscribeToProgress, getSnapshot);
}
