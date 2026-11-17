import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Страница не найдена");
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="mb-2 font-display text-6xl font-bold text-accent">404</p>
      <h1 className="mb-2 text-xl font-semibold">Страница не найдена</h1>
      <p className="mb-6 text-muted">
        Похоже, такой страницы не существует или тема ещё не добавлена в курс.
      </p>
      <Button asChild variant="accent">
        <Link to="/">На главную</Link>
      </Button>
    </div>
  );
}
