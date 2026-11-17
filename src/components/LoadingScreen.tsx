export function LoadingScreen() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-64 items-center justify-center gap-3 p-8 text-muted">
      <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
      Загрузка страницы…
    </div>
  );
}
