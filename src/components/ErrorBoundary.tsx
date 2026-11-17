import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  title?: string;
  description?: string;
  resetKey?: string;
}

/** Keep a failed route or optional visualization from unmounting the application. */
class ContentErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{this.props.title ?? "Не удалось открыть страницу"}</h1>
        <p className="text-muted">
          {this.props.description ?? "Проверьте подключение к интернету и обновите страницу. Сохранённый прогресс останется в вашем аккаунте."}
        </p>
        <Button type="button" onClick={() => window.location.reload()}>Обновить страницу</Button>
      </div>
    );
  }
}

export function ErrorBoundary({ resetKey, ...props }: ErrorBoundaryProps) {
  return <ContentErrorBoundary key={resetKey} {...props} />;
}
