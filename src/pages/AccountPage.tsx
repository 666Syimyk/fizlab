import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, Camera, CheckCircle2, Circle, Trash2, UserRound } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useAccountAccess } from "@/components/AccountAccessProvider";
import { Button } from "@/components/ui/button";
import { RecoveryCodeCard } from "@/components/auth/RecoveryCodeCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { AccountSecurity } from "@/components/auth/AccountSecurity";
import { authPost } from "@/lib/authApi";
import { runAuthMutation } from "@/lib/authMutations";
import { supabase } from "@/lib/supabaseClient";
import { getProgressSyncSnapshot, retryProgressSync, stopProgressSync, subscribeToProgressSync } from "@/lib/progressSync";
import { clearCurrentProgress } from "@/lib/progress";
import { prepareAvatar } from "@/lib/avatar";
import { useCompletedTopicSlugs, useTotalSolvedCount } from "@/hooks/useProgress";
import { sections } from "@/data/sections";
import { contentIndex } from "@/data/contentIndex";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const totalTopics = sections.reduce((sum, section) => sum + section.topics.length, 0);
const totalProblems = Object.values(contentIndex).reduce((sum, topic) => sum + topic.problemCount, 0);

export function AccountPage() {
  const { user } = useAuth();
  // Passwords and one-time recovery codes must never survive an account switch.
  return <AccountContent key={user?.id ?? "guest"} />;
}

function AccountContent() {
  useDocumentTitle("Личный кабинет");
  const { user, profile, loading, refreshProfile } = useAuth();
  const accountAccess = useAccountAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const deleteSection = useRef<HTMLElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [filter, setFilter] = useState<"remaining" | "completed">("remaining");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const completedSlugs = useCompletedTopicSlugs();
  const solvedCount = useTotalSolvedCount();
  const progressSync = useSyncExternalStore(subscribeToProgressSync, getProgressSyncSnapshot);
  const active = useRef(true);
  const mutationLock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (!loading && user && location.pathname === "/account/delete") deleteSection.current?.scrollIntoView({ block: "start" });
  }, [loading, user, location.pathname]);

  if (loading) return <div role="status" className="mx-auto max-w-4xl p-8">Загрузка…</div>;
  if (!user) return <div className="mx-auto max-w-4xl p-8"><h1 className="mb-4 text-3xl font-bold">Личный кабинет</h1><p>Чтобы открыть профиль, <Link className="text-accent underline" to="/login">войдите</Link> в аккаунт.</p></div>;

  const fullName = profile?.full_name || String(user.user_metadata?.full_name || "").trim();
  const firstName = profile?.first_name || String(user.user_metadata?.first_name || "") || fullName.split(" ")[0] || "";
  const lastName = profile?.last_name || String(user.user_metadata?.last_name || "") || fullName.split(" ").slice(1).join(" ") || "";
  const completed = new Set(completedSlugs);
  const completedCount = sections.reduce((sum, section) => sum + section.topics.filter(topic => completed.has(topic.slug)).length, 0);
  const remainingCount = totalTopics - completedCount;
  const percentage = Math.round((completedCount / totalTopics) * 100);
  const accountId = user.id;

  async function updateAvatar(value: string | null) {
    if (!user) return;
    const { error: saveError } = await supabase.from("profiles").update({ avatar_data: value }).eq("id", user.id);
    if (saveError) throw saveError;
    await refreshProfile();
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || mutationLock.current) return;
    mutationLock.current = true;
    setAvatarBusy(true);
    setAvatarError("");
    try {
      const avatar = await prepareAvatar(file);
      if (active.current) await updateAvatar(avatar);
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : "Не удалось загрузить фото.");
    } finally { mutationLock.current = false; setAvatarBusy(false); }
  }

  async function removePhoto() {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setAvatarBusy(true);
    setAvatarError("");
    try { await updateAvatar(null); }
    catch (cause) { setAvatarError(cause instanceof Error ? cause.message : "Не удалось удалить фото."); }
    finally { mutationLock.current = false; setAvatarBusy(false); }
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await runAuthMutation(async () => {
      const { data } = await supabase.auth.getSession();
      if (!active.current) return;
      if (data.session?.user.id !== accountId) throw new Error("Сессия завершена. Войдите снова.");
      await authPost("delete", { password }, data.session.access_token);
      if (!active.current) return;
      stopProgressSync();
      clearCurrentProgress();
      await supabase.auth.signOut({ scope: "local" });
      navigate("/", { replace: true });
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить аккаунт.");
    } finally { mutationLock.current = false; setBusy(false); }
  }

  async function regenerateCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationLock.current) return;
    mutationLock.current = true;
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!active.current) return;
      if (data.session?.user.id !== accountId) throw new Error("Сессия завершена. Войдите снова.");
      const result = await authPost<{ recovery_code: string }>("recovery-code", { password: recoveryPassword }, data.session.access_token);
      if (!active.current) return;
      setNewRecoveryCode(result.recovery_code);
      setRecoveryPassword("");
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : "Не удалось создать резервный код.");
    } finally { mutationLock.current = false; setRecoveryBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="text-center">
        <h1 className="mb-8 text-3xl font-bold">Личный кабинет</h1>
        <div className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-full border-4 border-accent/40 bg-surface-2 shadow-[0_0_40px_rgba(124,108,245,0.12)]">
          {profile?.avatar_data ? <img src={profile.avatar_data} alt="Фото профиля" className="h-full w-full object-cover" /> : <UserRound aria-hidden="true" className="h-16 w-16 text-muted-2" />}
        </div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarBusy || busy || recoveryBusy} className="sr-only" aria-label="Выбрать фото профиля" onChange={choosePhoto} />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={avatarBusy || busy || recoveryBusy} onClick={() => fileInput.current?.click()}><Camera className="h-4 w-4" />{avatarBusy ? "Загрузка…" : profile?.avatar_data ? "Изменить фото" : "Добавить фото"}</Button>
          {profile?.avatar_data && <Button type="button" variant="ghost" size="sm" disabled={avatarBusy || busy || recoveryBusy} onClick={() => void removePhoto()}><Trash2 className="h-4 w-4" />Удалить фото</Button>}
        </div>
        {avatarError && <p role="alert" className="mt-2 text-sm text-danger">{avatarError}</p>}
        <h2 className="mt-5 font-display text-2xl font-semibold [overflow-wrap:anywhere]">{firstName} {lastName}</h2>
        <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{user.email}</p>
        {accountAccess.fullAccess && <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
          <p className="font-semibold text-accent">{accountAccess.isSuperadmin ? "Суперадминистратор" : "Полный доступ предоставлен"}</p>
          <p className="mt-1 text-sm text-muted">{accountAccess.isSuperadmin ? "Все темы открыты без оплаты." : `До ${new Date(accountAccess.expiresAt!).toLocaleDateString("ru-RU")}`}</p>
          {accountAccess.isSuperadmin && <Button asChild variant="accent" className="mt-3 h-auto min-h-11 whitespace-normal"><Link to="/admin">Панель администратора</Link></Button>}
        </div>}
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-surface/60 p-5 sm:p-7" aria-labelledby="progress-heading">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="progress-heading" className="text-xl font-semibold">Мой прогресс</h2>
            <p className="mt-1 text-sm text-muted">Отмечайте темы изученными на странице каждой темы.</p>
          </div>
          <span className="font-display text-2xl font-bold text-accent">{percentage}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Изученные темы" aria-valuenow={completedCount} aria-valuemin={0} aria-valuemax={totalTopics}>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percentage}%` }} />
        </div>
        {progressSync.status !== "idle" && <div role="status" aria-live="polite" className="mt-3 text-sm text-muted">
          {progressSync.status === "error" ? <>
            <p>Не удалось синхронизировать. {progressSync.persistent
              ? "Изменения сохранены на этом устройстве."
              : "Копия хранится только в этой вкладке. Не закрывайте её до синхронизации."}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { void retryProgressSync(); }}>Повторить синхронизацию</Button>
          </> : <p>{progressSync.status === "syncing" ? "Синхронизация…" : "Сохранено в аккаунте"}</p>}
        </div>}
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-surface-2 p-3"><div className="text-xl font-bold text-success">{completedCount}</div><div className="text-xs text-muted">Изучено</div></div>
          <div className="rounded-xl bg-surface-2 p-3"><div className="text-xl font-bold">{remainingCount}</div><div className="text-xs text-muted">Осталось</div></div>
          <div className="rounded-xl bg-surface-2 p-3"><div className="text-xl font-bold text-accent">{solvedCount}</div><div className="text-xs text-muted">Задач из {totalProblems}</div></div>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="topics-heading">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="topics-heading" className="text-xl font-semibold">Темы курса</h2>
          <div className="flex rounded-lg border border-border p-1">
            <button type="button" aria-pressed={filter === "remaining"} onClick={() => setFilter("remaining")} className={`rounded-md px-3 py-1.5 text-sm transition-colors ${filter === "remaining" ? "bg-accent-strong text-white" : "text-muted hover:text-foreground"}`}>Осталось ({remainingCount})</button>
            <button type="button" aria-pressed={filter === "completed"} onClick={() => setFilter("completed")} className={`rounded-md px-3 py-1.5 text-sm transition-colors ${filter === "completed" ? "bg-accent-strong text-white" : "text-muted hover:text-foreground"}`}>Изучено ({completedCount})</button>
          </div>
        </div>
        {(filter === "completed" ? completedCount : remainingCount) === 0 ? (
          <p className="rounded-xl border border-border p-6 text-center text-muted">{filter === "completed" ? "Пока нет изученных тем. Откройте тему и отметьте её после изучения." : "Все темы изучены!"}</p>
        ) : sections.map(section => {
          const topics = section.topics.filter(topic => completed.has(topic.slug) === (filter === "completed"));
          if (!topics.length) return null;
          return (
            <div key={section.id} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{section.title}</h3>
              <div className="overflow-hidden rounded-xl border border-border">
                {topics.map(topic => (
                  <Link key={topic.slug} to={`/topic/${topic.slug}`} className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-surface-2">
                    {filter === "completed" ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-2" />}
                    <span className="flex-1">{topic.title}</span>
                    <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-2" />
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <div className="mx-auto max-w-2xl">
        <section className="mt-8 rounded-2xl border border-border p-6">
          <h2 className="mb-2 text-xl font-semibold">Подписка</h2>
          <p className="mb-4 text-sm text-muted">Выберите месячный или годовой доступ, восстановите покупки и проверьте статус подписки.</p>
          <Link to="/subscription" className="text-accent underline">Моя подписка</Link>
        </section>
        <AccountSecurity user={user} />
        <section className="mt-12 rounded-2xl border border-border p-6">
          <h2 className="mb-2 text-xl font-semibold">Резервный код</h2>
          <p className="mb-4 text-sm text-muted">Если вы потеряли код или хотите заменить его, подтвердите текущий пароль. Старый код сразу перестанет действовать.</p>
          {newRecoveryCode ? <RecoveryCodeCard code={newRecoveryCode} onContinue={() => setNewRecoveryCode("")} /> : (
            <form onSubmit={regenerateCode} aria-busy={recoveryBusy} className="flex flex-col gap-3">
              <PasswordInput value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} placeholder="Текущий пароль" autoComplete="current-password" required />
              {recoveryError && <p role="alert" className="text-sm text-danger">{recoveryError}</p>}
              <Button type="submit" variant="outline" disabled={recoveryBusy || busy || avatarBusy}>{recoveryBusy ? "Создаём…" : "Создать новый резервный код"}</Button>
            </form>
          )}
        </section>
        <section ref={deleteSection} className="mt-8 scroll-mt-24 rounded-2xl border border-danger/40 p-6">
          <h2 className="mb-2 text-xl font-semibold">Удалить аккаунт</h2>
          <p className="mb-4 text-sm text-muted">Будут удалены аккаунт, фото, сохранённый прогресс и история действий. Это действие нельзя отменить.</p>
          <p className="mb-4 text-sm text-muted">Удаление аккаунта не отменяет подписку Google Play. Чтобы остановить будущие списания, отмените её в <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer" className="text-accent underline">подписках Google Play</a>.</p>
          <form onSubmit={remove} aria-busy={busy} className="flex flex-col gap-3">
            <PasswordInput value={password} onChange={event => setPassword(event.target.value)} placeholder="Введите пароль для подтверждения" autoComplete="current-password" required />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" variant="outline" disabled={busy || recoveryBusy || avatarBusy}>{busy ? "Удаляем…" : "Удалить аккаунт и данные"}</Button>
          </form>
        </section>
      </div>
    </div>
  );
}
