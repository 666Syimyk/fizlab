const GUEST_KEY = "fizlab:solved-problems";
const GUEST_COMPLETED_KEY = "fizlab:completed-topics";
const CHANGE_EVENT = "fizlab:progress-changed";
let activeUser: string | null = null;
const storageKey = () => activeUser ? `fizlab:solved-problems:${activeUser}` : GUEST_KEY;
const completedStorageKey = () => activeUser ? `fizlab:completed-topics:${activeUser}` : GUEST_COMPLETED_KEY;
const changesStorageKey = () => `fizlab:completion-changes:${activeUser ?? "guest"}`;
const memoryValues = new Map<string, string | null>();
const memoryOnlyKeys = new Set<string>();

function readStored(key: string): string | null {
  // A failed write leaves an older value in storage. Prefer the newer in-memory
  // snapshot until persistence succeeds, including when reads still work.
  if (memoryOnlyKeys.has(key)) return memoryValues.get(key) ?? null;
  try {
    const value = localStorage.getItem(key);
    memoryValues.set(key, value);
    return value;
  } catch {
    memoryOnlyKeys.add(key);
    return memoryValues.get(key) ?? null;
  }
}

function writeStored(key: string, value: string | null) {
  memoryValues.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    memoryOnlyKeys.delete(key);
  } catch { memoryOnlyKeys.add(key); }
}

export function isProgressStoredLocally(): boolean {
  const keys = [storageKey(), completedStorageKey(), changesStorageKey()];
  for (const key of keys) readStored(key);
  return keys.every(key => !memoryOnlyKeys.has(key));
}

export type SolvedMap = Record<string, string[]>;
export type CompletionChanges = Record<string, boolean>;

export function normalizeSolvedMap(value: unknown): SolvedMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([slug, ids]) =>
    /^[a-z0-9-]{1,128}$/.test(slug) && Array.isArray(ids),
  ).slice(0, 256).map(([slug, ids]) => [slug, [...new Set((ids as unknown[]).filter((id): id is string =>
    typeof id === "string" && id.length > 0 && id.length <= 128,
  ))].slice(0, 1000)]));
}

function readAll(): SolvedMap {
  try {
    const raw = readStored(storageKey());
    return raw ? normalizeSolvedMap(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeAll(map: SolvedMap) {
  writeStored(storageKey(), JSON.stringify(map));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getSolvedIds(slug: string): Set<string> {
  return new Set(readAll()[slug] ?? []);
}

export function isSolved(slug: string, problemId: string): boolean {
  return getSolvedIds(slug).has(problemId);
}

export function markSolved(slug: string, problemId: string) {
  const all = readAll();
  const forSlug = new Set(all[slug] ?? []);
  if (forSlug.has(problemId)) return;
  forSlug.add(problemId);
  all[slug] = [...forSlug];
  writeAll(all);
}

export function getSolvedCount(slug: string): number {
  return (readAll()[slug] ?? []).length;
}

export function getTotalSolvedCount(): number {
  return Object.values(readAll()).reduce((sum, ids) => sum + ids.length, 0);
}

function readCompleted(key = completedStorageKey()): string[] {
  try {
    const value: unknown = JSON.parse(readStored(key) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter((slug): slug is string => typeof slug === "string" && /^[a-z0-9-]{1,128}$/.test(slug)))].slice(0, 256) : [];
  } catch { return []; }
}

export function getCompletedTopicSlugs(): string[] {
  return readCompleted();
}

export function isTopicCompleted(slug: string): boolean {
  return readCompleted().includes(slug);
}

export function setTopicCompleted(slug: string, completed: boolean) {
  const values = new Set(readCompleted());
  if (completed) values.add(slug);
  else values.delete(slug);
  // Preserve explicit removals until acknowledged; a union would undo them offline.
  const changes = getCompletionChanges();
  changes[slug] = completed;
  writeStored(changesStorageKey(), JSON.stringify(changes));
  replaceCompletedTopicSlugs([...values]);
}

export function getCompletionChanges(): CompletionChanges {
  try {
    const value: unknown = JSON.parse(readStored(changesStorageKey()) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([slug, completed]) =>
      /^[a-z0-9-]{1,128}$/.test(slug) && typeof completed === "boolean",
    )) as CompletionChanges;
  } catch { return {}; }
}

export function acknowledgeCompletionChanges(saved: CompletionChanges) {
  const changes = getCompletionChanges();
  for (const [slug, completed] of Object.entries(saved)) {
    if (changes[slug] === completed) delete changes[slug];
  }
  writeStored(changesStorageKey(), JSON.stringify(changes));
}

export function replaceCompletedTopicSlugs(slugs: string[]) {
  writeStored(completedStorageKey(), JSON.stringify([...new Set(slugs)]));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToProgress(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey() || event.key === completedStorageKey()) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Full local snapshot, for merging with the remote Supabase copy on login. */
export function getAllSolved(): SolvedMap {
  return readAll();
}

/** Overwrites the local store (e.g. after merging with remote progress) and notifies subscribers. */
export function replaceAllSolved(map: SolvedMap) {
  writeAll(map);
}

export function setProgressUser(userId: string | null) {
  activeUser = userId;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function guestProgress(): SolvedMap {
  try {
    return normalizeSolvedMap(JSON.parse(readStored(GUEST_KEY) || "{}"));
  } catch { return {}; }
}

export function guestCompletedTopics(): string[] {
  return readCompleted(GUEST_COMPLETED_KEY);
}

export function clearGuestProgress() {
  writeStored(GUEST_KEY, null);
  writeStored(GUEST_COMPLETED_KEY, null);
  writeStored("fizlab:completion-changes:guest", null);
}

export function clearCurrentProgress() {
  writeStored(storageKey(), null);
  writeStored(completedStorageKey(), null);
  writeStored(changesStorageKey(), null);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
