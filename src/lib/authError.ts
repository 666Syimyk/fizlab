export function authErrorMessage(error: unknown): string {
  const details = error as { status?: number; name?: string; message?: string } | null;
  if (!details?.status || details.status >= 500 || details.name === "AuthRetryableFetchError") {
    return "Сервис входа временно недоступен. Попробуйте позже.";
  }
  if (details.status === 400 || details.status === 401) {
    return "Проверьте email и пароль.";
  }
  return details.message || "Не удалось выполнить запрос. Попробуйте позже.";
}
