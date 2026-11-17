let pendingMutation: Promise<unknown> = Promise.resolve();

/** Wrap the entire login/logout/recovery operation; do not nest calls. */
export function runAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(() => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      // Browser tabs share auth storage, so the lock must cover SDK cleanup too.
      return navigator.locks.request("fizlab:auth-mutations", {
        mode: "exclusive", signal: AbortSignal.timeout(30000),
      }, operation);
    }
    return operation();
  });
  // Rejections are returned to their caller but must not block the next attempt.
  pendingMutation = result.catch(() => undefined);
  return result;
}
