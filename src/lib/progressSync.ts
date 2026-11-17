import { supabase } from "@/lib/supabaseClient";
import { getAllSolved, getCompletedTopicSlugs, replaceAllSolved, replaceCompletedTopicSlugs, subscribeToProgress, guestProgress, guestCompletedTopics, clearGuestProgress, normalizeSolvedMap, getCompletionChanges, acknowledgeCompletionChanges, isProgressStoredLocally, type SolvedMap } from "@/lib/progress";

interface ProgressSyncSnapshot {
  readonly status: "idle" | "syncing" | "synced" | "error";
  readonly persistent: boolean;
}
let syncSnapshot: ProgressSyncSnapshot = { status: "idle", persistent: true };
const syncListeners = new Set<() => void>();

export function getProgressSyncSnapshot(): ProgressSyncSnapshot { return syncSnapshot; }
export function subscribeToProgressSync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => { syncListeners.delete(listener); };
}
function publishSyncStatus(status: ProgressSyncSnapshot["status"]) {
  const persistent = isProgressStoredLocally();
  if (status === syncSnapshot.status && persistent === syncSnapshot.persistent) return;
  syncSnapshot = { status, persistent };
  for (const listener of syncListeners) listener();
}

interface SyncRun {
  userId: string;
  loaded: boolean;
  running: boolean;
  pending: boolean;
  guestMigrated: boolean;
  unsubscribe: (() => void) | null;
  onOnline: () => void;
}
let activeRun: SyncRun | null = null;

async function synchronize(run: SyncRun) {
  if (activeRun !== run) return;
  run.pending = true;
  publishSyncStatus("syncing");
  if (run.running) return;
  run.running = true;
  try {
    if (!run.loaded) {
      const { data, error } = await supabase.from("progress")
        .select("solved_problem_ids,completed_topic_slugs").eq("user_id", run.userId).maybeSingle();
      if (activeRun !== run) return;
      if (error) throw error;

      const merged: SolvedMap = normalizeSolvedMap(data?.solved_problem_ids);
      for (const map of [guestProgress(), getAllSolved()]) {
        for (const [slug, ids] of Object.entries(map)) merged[slug] = [...new Set([...(merged[slug] ?? []), ...ids])];
      }
      // The server owns acknowledged completion state. Only pending local
      // changes override it; otherwise an older device could restore removals.
      const savedCompleted = Array.isArray(data?.completed_topic_slugs) ? data.completed_topic_slugs : getCompletedTopicSlugs();
      const completed = new Set([...savedCompleted, ...guestCompletedTopics()]);
      for (const [slug, value] of Object.entries(getCompletionChanges())) {
        if (value) completed.add(slug);
        else completed.delete(slug);
      }
      replaceAllSolved(merged);
      replaceCompletedTopicSlugs([...completed]);
      run.loaded = true;
    }

    // Subscribe before the initial upload: edits during it queue a fresh snapshot.
    while (run.pending && activeRun === run) {
      run.pending = false;
      const changes = getCompletionChanges();
      const { error } = await supabase.from("progress").upsert({
        user_id: run.userId,
        solved_problem_ids: getAllSolved(),
        completed_topic_slugs: getCompletedTopicSlugs(),
        updated_at: new Date().toISOString(),
      });
      if (activeRun !== run) return;
      if (error) throw error;
      acknowledgeCompletionChanges(changes);
      if (!run.guestMigrated) {
        clearGuestProgress();
        run.guestMigrated = true;
      }
    }
    if (activeRun === run) publishSyncStatus("synced");
  } catch {
    // Retry on the next edit or reconnect. A failed load must be retried before
    // uploading so that an unavailable remote copy is never overwritten blindly.
    run.pending = true;
    if (activeRun === run) publishSyncStatus("error");
  } finally {
    run.running = false;
  }
}

export function retryProgressSync(): Promise<void> {
  return activeRun ? synchronize(activeRun) : Promise.resolve();
}

/** Merge once per active session, then serialize uploads and retry on reconnect. */
export async function migrateAndSyncProgress(userId: string) {
  stopProgressSync();
  const run: SyncRun = {
    userId, loaded: false, running: false, pending: false, guestMigrated: false, unsubscribe: null,
    onOnline: () => { void synchronize(run); },
  };
  activeRun = run;
  run.unsubscribe = subscribeToProgress(() => { void synchronize(run); });
  window.addEventListener("online", run.onOnline);
  await synchronize(run);
}

export function stopProgressSync() {
  const run = activeRun;
  activeRun = null;
  run?.unsubscribe?.();
  if (run) window.removeEventListener("online", run.onOnline);
  publishSyncStatus("idle");
}
