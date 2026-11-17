import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { useSubscription } from "@/components/SubscriptionProvider";

export function LockedTopicScreen() {
  const { user } = useAuth();
  const { error } = useSubscription();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface/60 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Lock className="h-6 w-6" />
      </span>
      <h2 className="text-xl font-semibold">Тема доступна с ФизЛаб Плюс</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        Полный курс, 3D-симуляции и задачи открываются по подписке на месяц или год.
        Бесплатные ознакомительные темы остаются доступными каждому.
      </p>
      {error && <p role="alert" className="max-w-md text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="accent">
          <Link to="/subscription">{error ? "Проверить подписку" : "Посмотреть подписку"}</Link>
        </Button>
        {!user && <Button asChild variant="outline"><Link to="/login?next=%2Fsubscription">Уже есть подписка? Войти</Link></Button>}
      </div>
    </div>
  );
}
