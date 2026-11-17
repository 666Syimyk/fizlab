import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, KeyRound, LoaderCircle, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useAccountAccess } from "@/components/AccountAccessProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getAdminOverview, getAdminUsers, grantAdminAccess, revokeAdminAccess, type AdminGrantDays, type AdminOverview, type AdminUser, type AdminUsersPage } from "@/lib/admin";

type LoadState<T> = { data: T | null; loading: boolean; error: string };
type PendingAction = { user: AdminUser; type: "grant"; days: AdminGrantDays } | { user: AdminUser; type: "revoke" };
const emptyLoad = { data: null, loading: true, error: "" };
const pageSize = 20;
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить запрос. Повторите попытку.";
}

export function AdminPage() {
  useDocumentTitle("Панель администратора");
  const { user, loading: authLoading } = useAuth();
  const { loading, isSuperadmin, error, refresh } = useAccountAccess();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/account" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Личный кабинет</Link>
      <div className="mb-7 flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
        <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Панель администратора</h1><p className="mt-2 text-sm leading-relaxed text-muted">Пользователи и доступ к полному курсу.</p></div>
      </div>
      {authLoading ? <LoadingNotice /> : !user ? (
        <section className="rounded-2xl border border-border bg-surface/60 p-6">
          <h2 className="text-xl font-semibold">Войдите в аккаунт администратора</h2>
          <p className="mt-3 text-sm text-muted">Панель доступна только владельцу с подтверждёнными правами.</p>
          <Button asChild variant="accent" className="mt-5"><Link to="/login?next=%2Fadmin">Войти</Link></Button>
        </section>
      ) : loading ? <LoadingNotice /> : error ? (
        <section role="alert" className="rounded-2xl border border-danger/30 bg-surface/60 p-6">
          <h2 className="text-xl font-semibold">Не удалось проверить права доступа</h2>
          <p className="mt-3 text-sm text-muted">{error}</p>
          <Button variant="outline" className="mt-5" onClick={() => { void refresh().catch(() => {}); }}>Повторить проверку</Button>
        </section>
      ) : !isSuperadmin ? (
        <section className="rounded-2xl border border-border bg-surface/60 p-6">
          <h2 className="text-xl font-semibold">Доступ ограничен</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">У этого аккаунта нет прав администратора. Для продолжения откройте личный кабинет.</p>
          <Button asChild variant="outline" className="mt-5"><Link to="/account">В личный кабинет</Link></Button>
        </section>
      ) : <AdminDashboard key={user.id} userId={user.id} />}
    </div>
  );
}

function LoadingNotice() {
  return <div role="status" className="flex items-center gap-3 rounded-2xl border border-border bg-surface/60 p-6 text-sm text-muted"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />Проверяем доступ…</div>;
}

function AdminDashboard({ userId }: { userId: string }) {
  const [overview, setOverview] = useState<LoadState<AdminOverview>>(emptyLoad);
  const [users, setUsers] = useState<LoadState<AdminUsersPage>>(emptyLoad);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", offset: 0 });
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const active = useRef(false);
  const requestRevision = useRef(0);
  const mutationLock = useRef(false);
  const mutationController = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    const cancelWork = () => {
      active.current = false;
      ++requestRevision.current;
      mutationController.current?.abort();
    };
    return cancelWork;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const ticket = ++requestRevision.current;
    setOverview(emptyLoad);
    setUsers(emptyLoad);
    setPending(null);
    const current = () => active.current && !controller.signal.aborted && ticket === requestRevision.current;
    void Promise.allSettled([
      getAdminOverview(userId, controller.signal),
      getAdminUsers(userId, { ...query, limit: pageSize }, controller.signal),
    ]).then(([overviewResult, usersResult]) => {
      if (!current()) return;
      setOverview(overviewResult.status === "fulfilled"
        ? { data: overviewResult.value, loading: false, error: "" }
        : { data: null, loading: false, error: errorMessage(overviewResult.reason) });
      if (usersResult.status === "fulfilled") {
        const result = usersResult.value;
        if (query.offset > 0 && query.offset >= result.total) {
          setQuery((previous) => ({ ...previous, offset: Math.max(0, Math.ceil(result.total / pageSize) - 1) * pageSize }));
          return;
        }
        setUsers({ data: result, loading: false, error: "" });
        setNow(Date.now());
      } else setUsers({ data: null, loading: false, error: errorMessage(usersResult.reason) });
    });
    return () => { controller.abort(); };
  }, [userId, query, reload]);

  useEffect(() => {
    const expirations = users.data?.users.map((entry) => Date.parse(entry.grantExpiresAt ?? "")).filter((expiry) => expiry > now) ?? [];
    if (!expirations.length) return;
    const delay = Math.min(Math.max(0, Math.min(...expirations) - Date.now()) + 100, 2_147_483_647);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [users.data, now]);

  function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationLock.current) return;
    setPending(null);
    setQuery({ search: search.trim(), offset: 0 });
    setMessage("");
    setMutationError("");
  }

  function requestAction(action: PendingAction) {
    if (mutationLock.current || action.user.isSuperadmin || action.user.id === userId) return;
    setPending(action);
    setMutationError("");
    setMessage("");
  }

  async function confirmAction() {
    if (!pending || mutationLock.current || !active.current || pending.user.isSuperadmin || pending.user.id === userId) return;
    mutationLock.current = true;
    setBusy(true);
    setMutationError("");
    const action = pending;
    const controller = new AbortController();
    mutationController.current = controller;
    try {
      if (action.type === "grant") await grantAdminAccess(userId, action.user.id, action.days, controller.signal);
      else await revokeAdminAccess(userId, action.user.id, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      setMessage(action.type === "grant"
        ? `Доступ для ${action.user.email} установлен на ${action.days} дней с сегодняшнего дня. Подписка Google Play не изменилась.`
        : `Выданный доступ для ${action.user.email} закрыт. Подписка Google Play не изменилась.`);
    } catch (error) {
      if (!active.current || controller.signal.aborted) return;
      setMutationError(`Не удалось подтвердить изменение. ${errorMessage(error)} Проверьте срок доступа перед повторной попыткой.`);
    } finally {
      if (active.current && !controller.signal.aborted) {
        mutationController.current = null;
        mutationLock.current = false;
        setBusy(false);
        setPending(null);
        setUsers(emptyLoad);
        setReload((value) => value + 1);
      }
    }
  }

  const page = users.data;
  const stats = [
    { label: "Пользователей", value: overview.data?.totalUsers, icon: Users },
    { label: "Администраторов", value: overview.data?.superadmins, icon: ShieldCheck },
    { label: "Активных выданных доступов", value: overview.data?.activeGrants, icon: KeyRound },
  ];

  return (
    <>
      <p className="mb-6 rounded-xl border border-accent/20 bg-accent/5 p-4 text-sm leading-relaxed">Выданный доступ не списывает деньги и не меняет подписку Google Play. Управлять оплатой и продлением пользователь может в Google Play.</p>
      <section aria-label="Статистика пользователей" className="grid gap-3 sm:grid-cols-3" aria-busy={overview.loading}>
        {stats.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-border bg-surface/60 p-5"><Icon className="mb-3 h-5 w-5 text-accent" aria-hidden="true" /><p className="text-2xl font-bold tabular-nums">{value === undefined ? "—" : value.toLocaleString("ru-RU")}</p><p className="mt-1 text-sm leading-relaxed text-muted">{label}</p></div>)}
      </section>
      {overview.error && <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 p-4 text-sm"><p className="min-w-0 flex-1">Статистика недоступна. {overview.error}</p><Button variant="outline" disabled={busy || overview.loading} onClick={() => setReload((value) => value + 1)}>Повторить</Button></div>}

      <section className="mt-8" aria-labelledby="admin-users-title">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 id="admin-users-title" className="text-xl font-semibold">Пользователи</h2><Button variant="outline" className="min-h-11" disabled={busy || users.loading} onClick={() => setReload((value) => value + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" />Обновить список</Button></div>
        <form onSubmit={searchUsers} className="mb-5" role="search" aria-label="Поиск пользователей">
          <label htmlFor="admin-user-search" className="mb-2 block text-sm font-medium">Email или имя пользователя</label>
          <div className="flex flex-col gap-3 sm:flex-row"><Input id="admin-user-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={254} placeholder="Найдите пользователя" autoComplete="off" disabled={busy} className="min-h-11 min-w-0 flex-1" /><Button type="submit" variant="accent" className="min-h-11" disabled={busy}><Search className="h-4 w-4" aria-hidden="true" />Найти</Button></div>
        </form>
        {message && <p role="status" className="mb-4 rounded-xl border border-success/30 bg-success/5 p-4 text-sm leading-relaxed [overflow-wrap:anywhere]">{message}</p>}
        {mutationError && <p role="alert" className="mb-4 rounded-xl border border-danger/30 p-4 text-sm leading-relaxed [overflow-wrap:anywhere]">{mutationError}</p>}
        {users.loading ? <div role="status" className="flex items-center gap-3 rounded-2xl border border-border p-6 text-sm text-muted"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />Загружаем пользователей…</div> : users.error ? (
          <div role="alert" className="rounded-2xl border border-danger/30 bg-surface/60 p-6"><h3 className="font-semibold">Не удалось загрузить пользователей</h3><p className="mt-2 text-sm leading-relaxed text-muted">{users.error}</p><Button className="mt-4" variant="outline" onClick={() => setReload((value) => value + 1)}>Повторить загрузку</Button></div>
        ) : page && page.users.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface/60 p-6 text-center"><p className="font-medium">{query.search ? "По вашему запросу никого не найдено" : "Пользователей пока нет"}</p>{query.search && <Button variant="outline" className="mt-4" onClick={() => { setSearch(""); setQuery({ search: "", offset: 0 }); }}>Сбросить поиск</Button>}</div>
        ) : page && (
          <>
            <p className="mb-3 text-sm text-muted" role="status">Показаны {page.offset + 1}–{page.offset + page.users.length} из {page.total}</p>
            <ul className="space-y-4">
              {page.users.map((entry) => <li key={entry.id}><AdminUserCard user={entry} actorId={userId} now={now} busy={busy || Boolean(pending && pending.user.id !== entry.id)} pending={pending?.user.id === entry.id ? pending : null} onRequest={requestAction} onCancel={() => setPending(null)} onConfirm={() => { void confirmAction(); }} /></li>)}
            </ul>
            <nav aria-label="Страницы пользователей" className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" className="min-h-11" disabled={busy || page.offset === 0} onClick={() => { setPending(null); setQuery((previous) => ({ ...previous, offset: Math.max(0, previous.offset - pageSize) })); }}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Назад</Button>
              <p className="text-sm text-muted">Страница {Math.floor(page.offset / pageSize) + 1} из {Math.max(1, Math.ceil(page.total / pageSize))}</p>
              <Button variant="outline" className="min-h-11" disabled={busy || page.offset + page.users.length >= page.total} onClick={() => { setPending(null); setQuery((previous) => ({ ...previous, offset: previous.offset + pageSize })); }} >Далее<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            </nav>
          </>
        )}
      </section>
    </>
  );
}

function AdminUserCard({ user, actorId, now, busy, pending, onRequest, onCancel, onConfirm }: {
  user: AdminUser; actorId: string; now: number; busy: boolean; pending: PendingAction | null;
  onRequest: (action: PendingAction) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const [days, setDays] = useState<AdminGrantDays>(30);
  const confirmation = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const previousAction = useRef<PendingAction["type"] | null>(null);
  const expiresAt = user.grantExpiresAt ? Date.parse(user.grantExpiresAt) : null;
  const hasGrant = expiresAt !== null && expiresAt > now;
  const protectedAccount = user.isSuperadmin || user.id === actorId;
  const selectId = `grant-days-${user.id}`;
  const confirmId = `confirm-access-${user.id}`;

  useEffect(() => {
    if (pending) confirmation.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (previousAction.current) {
      actions.current?.querySelector<HTMLButtonElement>(`[data-admin-action="${previousAction.current}"]`)?.focus();
    }
    previousAction.current = pending?.type ?? null;
  }, [pending]);

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h3 className="font-semibold [overflow-wrap:anywhere]">{user.name.trim() || "Без имени"}</h3><p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{user.email}</p><p className="mt-2 text-xs text-muted">Регистрация: {dateFormatter.format(new Date(user.createdAt))}</p></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 ${user.isSuperadmin ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted"}`}>{user.isSuperadmin ? "Администратор" : "Пользователь"}</span>{user.emailVerified && <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Email подтверждён</span>}</div>
      </div>
      <div className="mt-4 border-t border-border pt-4">
        {user.isSuperadmin ? <p className="flex items-center gap-2 text-sm font-medium text-accent"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />Полный доступ без срока</p>
          : <p className={`flex items-start gap-2 text-sm leading-relaxed ${hasGrant ? "text-success" : "text-muted"}`}><Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{expiresAt === null ? "Выданного доступа нет" : `${hasGrant ? "Доступ выдан до" : "Выданный доступ истёк"} ${dateFormatter.format(new Date(expiresAt))}`}</p>}
        {!protectedAccount && <>
          <div ref={actions} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 sm:w-44"><label htmlFor={selectId} className="mb-1.5 block text-xs font-medium text-muted">Срок доступа</label><select id={selectId} value={days} disabled={busy || Boolean(pending)} onChange={(event) => setDays(event.target.value === "365" ? 365 : 30)} className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"><option value={30}>30 дней</option><option value={365}>365 дней</option></select></div>
            <Button data-admin-action="grant" variant="accent" className="min-h-11" disabled={busy || Boolean(pending)} onClick={() => onRequest({ user, type: "grant", days })}>{hasGrant ? "Изменить срок" : "Выдать доступ"}</Button>
            {hasGrant && <Button data-admin-action="revoke" variant="outline" className="h-auto min-h-11 whitespace-normal text-danger" disabled={busy || Boolean(pending)} onClick={() => onRequest({ user, type: "revoke" })}>Закрыть выданный доступ</Button>}
          </div>
          {pending && <div ref={confirmation} role="group" aria-labelledby={confirmId} className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
            <p id={confirmId} className="text-sm font-semibold [overflow-wrap:anywhere]">{pending.type === "revoke" ? "Закрыть выданный доступ" : hasGrant ? "Изменить срок доступа" : "Выдать доступ"} для {user.email}?</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{pending.type === "grant" ? `Доступ на ${pending.days} дней с сегодняшнего дня. ${user.grantExpiresAt ? "Новый срок заменит текущий." : "Доступ начнётся после подтверждения."}` : "Будет закрыт только доступ, выданный администратором."} Подписка Google Play и списания не изменятся.</p>
            <div className="mt-4 flex flex-wrap gap-3"><Button variant={pending.type === "revoke" ? "outline" : "accent"} disabled={busy} className="h-auto min-h-11 whitespace-normal" onClick={onConfirm}>{busy ? "Сохраняем…" : pending.type === "revoke" ? "Да, закрыть доступ" : "Подтвердить выдачу"}</Button><Button variant="ghost" disabled={busy} className="min-h-11" onClick={onCancel}>Отмена</Button></div>
          </div>}
        </>}
        {protectedAccount && !user.isSuperadmin && <p className="mt-3 text-sm text-muted">Выдавать доступ собственному аккаунту нельзя.</p>}
      </div>
    </article>
  );
}
