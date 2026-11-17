import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Atom, BookOpen, Box, Check, CheckCircle2, ChevronDown, ExternalLink, Focus, GraduationCap, LoaderCircle, Orbit, Radiation, RotateCcw, ShieldCheck, Sparkles, Thermometer, Zap } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useAccountAccess } from "@/components/AccountAccessProvider";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { billingAvailable, getManageSubscriptionsUrl, loadBillingPlans, purchasePlan, restorePurchases, type BillingPlan } from "@/lib/billing";
import { sections } from "@/data/sections";
import { FREE_DEMO_SLUGS } from "@/lib/access";

const features = [
  { icon: Box, title: "Наблюдайте и экспериментируйте", description: "Меняйте параметры в 3D-симуляциях и смотрите, как работают законы физики." },
  { icon: BookOpen, title: "Разбирайтесь шаг за шагом", description: "Конспекты, формулы и разобранные примеры в каждой теме." },
  { icon: GraduationCap, title: "Закрепляйте знания", description: "Решайте задачи с проверкой ответа. Сохраняйте прогресс в аккаунте." },
];

const demoStyles = [
  { icon: Orbit, color: "text-violet-300 bg-violet-400/10", label: "Механика" },
  { icon: Thermometer, color: "text-orange-300 bg-orange-400/10", label: "Термодинамика" },
  { icon: Zap, color: "text-amber-300 bg-amber-400/10", label: "Электромагнетизм" },
  { icon: Focus, color: "text-cyan-300 bg-cyan-400/10", label: "Оптика" },
  { icon: Atom, color: "text-emerald-300 bg-emerald-400/10", label: "Квантовая физика" },
  { icon: Radiation, color: "text-rose-300 bg-rose-400/10", label: "Ядерная физика" },
];

const freeTopics = sections.flatMap((section, index) => section.topics
  .filter((topic) => FREE_DEMO_SLUGS.has(topic.slug))
  .map((topic) => ({ ...topic, ...demoStyles[index] })));

const faqs = [
  { question: "Что доступно бесплатно?", answer: "Шесть полноценных тем — по одной из каждого раздела. В них открыты теория, 3D-симуляции и задачи. Начать можно без регистрации и банковской карты. Аккаунт понадобится, чтобы сохранять прогресс." },
  { question: "Как работает подписка?", answer: "ФизЛаб Плюс открывает весь курс. Когда оформление доступно, в приложении Android можно выбрать месяц или год. Год оплачивается одним платежом. Стоимость отображается перед оплатой в Google Play. Подписка продлевается автоматически до отмены." },
  { question: "Как отменить подписку?", answer: "Откройте Google Play → «Платежи и подписки» → «Подписки» → «ФизЛаб 3D». После отмены продления доступ сохранится до конца оплаченного периода. Удаление приложения или аккаунта само по себе не отменяет подписку." },
];

function UnavailablePlans({ reason }: { reason: string }) {
  return (
    <>
      <p id="purchase-unavailable" className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3 text-sm leading-relaxed">{reason}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["monthly", "annual"] as const).map((period) => (
          <article key={period} className={"flex flex-col rounded-2xl border p-4 " + (period === "annual" ? "border-accent/40 bg-accent/5" : "border-border bg-surface-2/50")}>
            <h3 className="text-lg font-semibold">{period === "annual" ? "На год" : "На месяц"}</h3>
            <p className="mt-2 text-sm text-muted">Все темы, симуляции и задачи</p>
            <p className="mb-4 mt-4 text-xs text-muted">Цена пока недоступна</p>
            <Button disabled aria-describedby="purchase-unavailable" variant={period === "annual" ? "accent" : "outline"} className="mt-auto h-auto min-h-11 w-full whitespace-normal px-3 py-3 disabled:opacity-70">
              {period === "annual" ? "Купить на год" : "Купить на месяц"}
            </Button>
          </article>
        ))}
      </div>
    </>
  );
}

export function SubscriptionPage() {
  useDocumentTitle("Подписка ФизЛаб Плюс");
  const { user, loading: authLoading } = useAuth();
  const { loading, configured, entitlement, error, refresh } = useSubscription();
  const accountAccess = useAccountAccess();
  const nativeBilling = billingAvailable();
  const userId = user?.id ?? null;
  const emailVerified = Boolean(user?.email_confirmed_at);
  const [planState, setPlanState] = useState<{ userId: string | null; plans: BillingPlan[] }>({ userId: null, plans: [] });
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState("");
  const [plansAttempt, setPlansAttempt] = useState(0);
  const [busy, setBusy] = useState<"monthly" | "annual" | "restore" | "refresh" | null>(null);
  const [message, setMessage] = useState("");
  const [operationError, setOperationError] = useState("");
  const operation = useRef(0);
  const currentUser = useRef(userId);
  const operationLock = useRef(false);
  currentUser.current = userId;

  useEffect(() => {
    const invalidateOperation = () => { ++operation.current; };
    invalidateOperation();
    operationLock.current = false;
    setBusy(null);
    setMessage("");
    setOperationError("");
    return invalidateOperation;
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setPlanState({ userId, plans: [] });
    setPlansError("");
    if (!userId || !nativeBilling || !configured || !emailVerified || entitlement.active || accountAccess.loading || accountAccess.fullAccess) {
      setPlansLoading(false);
      return;
    }
    setPlansLoading(true);
    void loadBillingPlans(userId).then((plans) => {
      if (cancelled) return;
      setPlanState({ userId, plans });
      if (!plans.length) setPlansError("Тарифы пока недоступны в Google Play. Повторите попытку позже.");
    }).catch((failure) => {
      if (!cancelled) setPlansError(failure instanceof Error ? failure.message : "Не удалось загрузить тарифы из Google Play.");
    }).finally(() => { if (!cancelled) setPlansLoading(false); });
    return () => { cancelled = true; };
  }, [userId, nativeBilling, configured, emailVerified, entitlement.active, plansAttempt, accountAccess.loading, accountAccess.fullAccess]);

  async function runOperation(kind: "monthly" | "annual" | "restore" | "refresh") {
    if (!userId || operationLock.current) return;
    if (kind !== "refresh" && (!nativeBilling || !configured || !emailVerified)) return;
    if ((kind === "monthly" || kind === "annual") && (!emailVerified || entitlement.active || accountAccess.loading || accountAccess.fullAccess)) return;
    operationLock.current = true;
    const ticket = ++operation.current;
    setBusy(kind);
    setMessage("");
    setOperationError("");
    try {
      if (kind === "restore") await restorePurchases(userId);
      else if (kind !== "refresh") await purchasePlan(userId, kind);
      if (currentUser.current !== userId || ticket !== operation.current) return;
      const result = await refresh(kind !== "refresh");
      if (currentUser.current !== userId || ticket !== operation.current || !result) return;
      setMessage(result.entitlement.active
        ? "Подписка подтверждена. Все темы открыты."
        : kind === "refresh"
          ? "Активная подписка не найдена. Бесплатные темы доступны."
          : "Активная подписка пока не подтверждена. Если покупка уже оплачена, подождите немного и нажмите «Восстановить покупки». Повторная оплата не нужна.");
    } catch (failure) {
      if (currentUser.current === userId && ticket === operation.current) {
        setOperationError(failure instanceof Error ? failure.message : "Не удалось выполнить операцию. Повторите попытку.");
      }
    } finally {
      if (currentUser.current === userId && ticket === operation.current) {
        operationLock.current = false;
        setBusy(null);
      }
    }
  }

  const plans = planState.userId === userId ? planState.plans : [];
  const topicCount = sections.reduce((count, section) => count + section.topics.length, 0);
  const expiresAt = entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 sm:pb-16 sm:pt-8">
      <Link to="/" className="mb-7 inline-flex min-h-10 items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Назад к курсу</Link>
      <div className="grid items-start gap-7 lg:grid-cols-[1.05fr_1fr] lg:gap-x-14 lg:gap-y-7">
        <div className="min-w-0 lg:pt-3">
          <span className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-accent"><Sparkles className="h-5 w-5" aria-hidden="true" />ФизЛаб Плюс</span>
          <h1 className="max-w-xl text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl xl:text-5xl">Откройте весь<br /><span className="text-accent">курс физики</span></h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">От первого эксперимента до уверенного решения задач. Теория, практика и наглядные объяснения — в одном месте.</p>
          {!entitlement.active && !accountAccess.fullAccess && <Link to="/topic/kinematics" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline lg:hidden">Попробовать бесплатно <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
          <dl className="mt-7 grid max-w-md grid-cols-3 divide-x divide-border border-y border-border py-5">
            <div className="pr-3"><dt className="text-xs text-muted sm:text-sm">тем в курсе</dt><dd className="mt-1 text-2xl font-semibold">{topicCount}</dd></div>
            <div className="px-4"><dt className="text-xs text-muted sm:text-sm">разделов</dt><dd className="mt-1 text-2xl font-semibold">{sections.length}</dd></div>
            <div className="pl-4"><dt className="text-xs text-muted sm:text-sm">симуляции</dt><dd className="mt-1 text-2xl font-semibold">3D</dd></div>
          </dl>
        </div>
        <ul className="order-3 space-y-5 lg:col-start-1 lg:row-start-2">
          {features.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2/80 text-accent"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <div><h2 className="text-sm font-semibold sm:text-base">{title}</h2><p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p></div>
            </li>
          ))}
        </ul>
        <div className="order-2 min-w-0 rounded-3xl border border-accent/20 bg-surface p-5 shadow-[0_20px_80px_-40px_rgba(155,138,251,0.35)] sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Ваш доступ</span>
            {!authLoading && !accountAccess.loading && (!loading || accountAccess.fullAccess) && <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " + (entitlement.active || accountAccess.fullAccess ? "bg-success/10 text-success" : "bg-accent/10 text-accent")}>
              {entitlement.active || accountAccess.fullAccess ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
              {accountAccess.fullAccess ? "Все темы открыты" : entitlement.active ? "Плюс подключён" : "6 тем бесплатно"}
            </span>}
          </div>
          {authLoading || accountAccess.loading || (loading && !accountAccess.fullAccess) ? (
            <div role="status" className="flex min-h-56 flex-col items-center justify-center gap-4 text-muted"><LoaderCircle className="h-7 w-7 animate-spin text-accent" aria-hidden="true" />Проверяем подписку…</div>
          ) : accountAccess.fullAccess ? (
            <section aria-labelledby="account-full-access">
              <ShieldCheck className="mb-4 h-10 w-10 text-accent" aria-hidden="true" />
              <h2 id="account-full-access" className="text-2xl font-semibold">{accountAccess.isSuperadmin ? "Доступ владельца" : "Доступ предоставлен"}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">Все {topicCount} темы, симуляции и задачи открыты{accountAccess.expiresAt ? ` до ${new Date(accountAccess.expiresAt).toLocaleDateString("ru-RU")}` : " без ограничения срока"}.</p>
              <p className="mt-3 text-sm text-muted">За этот доступ плата не списывается. Он не меняет подписки, оформленные в Google Play.</p>
              <div className="mt-5 grid gap-3">
                <Button asChild variant="accent" size="lg"><Link to="/">К занятиям <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                {accountAccess.isSuperadmin && <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-3"><Link to="/admin">Панель администратора</Link></Button>}
                {entitlement.active && <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-3"><a href={getManageSubscriptionsUrl()} target="_blank" rel="noreferrer">Управлять подпиской в Google Play <ExternalLink className="h-4 w-4" aria-hidden="true" /></a></Button>}
              </div>
            </section>
          ) : entitlement.active ? (
            <section aria-labelledby="active-subscription">
              <CheckCircle2 className="mb-4 h-10 w-10 text-success" aria-hidden="true" />
              <h2 id="active-subscription" className="text-2xl font-semibold">ФизЛаб Плюс активен</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">Вам доступны все {topicCount} темы, симуляции и задачи. Продолжайте с того места, где остановились.</p>
              <p className="mt-5 rounded-xl bg-surface-2 px-4 py-3 text-sm">{entitlement.willRenew ? "Следующее продление — " : "Доступ действует до "}{expiresAt}.</p>
              <div className="mt-5 grid gap-3">
                <Button asChild variant="accent" size="lg"><Link to="/">К занятиям <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-3"><a href={getManageSubscriptionsUrl()} target="_blank" rel="noreferrer">Управлять в Google Play <ExternalLink className="h-4 w-4" aria-hidden="true" /></a></Button>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">Отменить продление можно в Google Play. Доступ сохранится до конца оплаченного периода.</p>
            </section>
          ) : !user ? (
            <section aria-labelledby="guest-subscription">
              <h2 id="guest-subscription" className="text-2xl font-semibold">Войдите, чтобы выбрать тариф</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">Подписка на месяц или год открывает весь курс и сохраняется в вашем аккаунте.</p>
              <UnavailablePlans reason="Для покупки войдите в аккаунт в приложении Android. Цена и доступность подписки проверяются перед оплатой." />
              <div className="mt-6 grid gap-3">
                <Button asChild variant="accent" size="lg"><Link to="/register?next=%2Fsubscription">Создать аккаунт <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                <Button asChild variant="outline" size="lg"><Link to="/login?next=%2Fsubscription">Войти</Link></Button>
              </div>
              <p className="mt-4 text-center text-xs text-muted">Регистрация бесплатна и не оформляет подписку.</p>
              <div className="mt-6 border-t border-border pt-5 text-center"><Link to="/topic/kinematics" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline">Сначала попробовать бесплатно <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
            </section>
          ) : error ? (
            <section role="alert" aria-labelledby="subscription-error">
              <h2 id="subscription-error" className="text-2xl font-semibold">Не удалось проверить подписку</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">{error}</p>
              <p className="mt-3 text-sm text-muted">Пока вы можете продолжить с бесплатных тем.</p>
              <Button className="mt-6 w-full" variant="accent" size="lg" disabled={Boolean(busy)} onClick={() => { void runOperation("refresh"); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Повторить проверку</Button>
              <a href="#free-topics" className="mt-3 flex min-h-11 items-center justify-center text-sm text-accent hover:underline">Посмотреть бесплатные темы</a>
            </section>
          ) : !configured ? (
            <section aria-labelledby="buy-subscription">
              <h2 id="buy-subscription" className="text-2xl font-semibold">Купить подписку</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">Месяц или год полного доступа. В обоих тарифах — все {topicCount} темы курса.</p>
              <UnavailablePlans reason="Оплата ещё не подключена, поэтому купить подписку пока нельзя. Цены появятся после запуска покупок через Google Play." />
              <div className="mt-5 border-t border-border pt-5">
                <p className="mb-4 text-sm leading-relaxed text-muted">А пока попробуйте {FREE_DEMO_SLUGS.size} бесплатных тем — без карты и регистрации.</p>
                <Button asChild variant="outline" size="lg" className="w-full"><Link to="/topic/kinematics">Начать бесплатно <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                <a href="#free-topics" className="mt-2 flex min-h-11 items-center justify-center gap-1.5 text-sm text-accent hover:underline">Выбрать другую тему <ChevronDown className="h-4 w-4" aria-hidden="true" /></a>
              </div>
            </section>
          ) : !nativeBilling ? (
            <section aria-labelledby="android-subscription">
              <h2 id="android-subscription" className="text-2xl font-semibold">Подписка оформляется в Android</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">Выберите месяц или год в приложении ФизЛаб 3D для Android. Оплата проходит через Google Play.</p>
              <UnavailablePlans reason="В браузере купить подписку нельзя. Откройте приложение Android, чтобы посмотреть цену и перейти к оплате." />
              <p className="mt-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed">Уже оплатили? Войдите в тот же аккаунт и нажмите «Обновить статус» ниже — ваш доступ работает и в браузере.</p>
              <Button asChild variant="accent" size="lg" className="mt-6 w-full"><Link to="/topic/kinematics">Начать бесплатно <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
            </section>
          ) : !emailVerified ? (
            <section aria-labelledby="verify-subscription">
              <ShieldCheck className="mb-4 h-10 w-10 text-accent" aria-hidden="true" />
              <h2 id="verify-subscription" className="text-2xl font-semibold">Подтвердите email перед оплатой</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">Так вы сможете восстановить доступ к аккаунту и своей подписке. Подтверждение доступно в личном кабинете.</p>
              <Button asChild variant="accent" size="lg" className="mt-6 w-full"><Link to="/account">Подтвердить email <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
            </section>
          ) : (
            <section aria-label="Тарифы Google Play">
              <h2 className="text-2xl font-semibold">Выберите удобный срок</h2>
              <p className="mt-2 text-sm text-muted">Оба тарифа открывают весь курс.</p>
              {plansLoading && <p role="status" className="flex items-center gap-3 py-8 text-sm text-muted"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />Загружаем цены из Google Play…</p>}
              {plansError && <div role="alert" className="mt-5 rounded-xl border border-border bg-surface-2 p-4"><p className="mb-3 text-sm text-muted">{plansError}</p><Button variant="outline" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => setPlansAttempt((attempt) => attempt + 1)}>Загрузить тарифы снова</Button></div>}
              <div className="mt-5 grid gap-3">
                {plans.map((plan) => (
                  <article key={plan.id} className={"rounded-2xl border p-4 sm:p-5 " + (plan.id === "annual" ? "border-accent/50 bg-accent/5" : "border-border bg-surface-2/50")}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2"><h3 className="text-lg font-semibold">{plan.id === "annual" ? "На год" : "На месяц"}</h3><p className="break-words text-2xl font-bold tracking-tight">{plan.price}</p></div>
                    <p className="mt-2 text-xs text-muted">{plan.id === "annual" ? "Вся сумма за 1 год, одним платежом" : "Вся сумма за 1 месяц"}</p>
                    <p className="mt-3 text-xs leading-relaxed text-muted">Автоматическое продление {plan.id === "annual" ? "каждый год" : "каждый месяц"}. Можно отменить в Google Play.</p>
                    <Button className="mt-4 h-auto min-h-11 w-full whitespace-normal py-3" variant={plan.id === "annual" ? "accent" : "outline"} disabled={Boolean(busy) || loading || plansLoading} onClick={() => { void runOperation(plan.id); }}>
                      {busy === plan.id ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Подтверждаем…</> : "Купить за " + plan.price}
                    </Button>
                  </article>
                ))}
              </div>
              {plans.length > 0 && <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />Оплата и подтверждение — в Google Play. Итоговая сумма и условия будут показаны перед покупкой.</p>}
            </section>
          )}
          {message && <p role="status" className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm leading-relaxed">{message}</p>}
          {operationError && <p role="alert" className="mt-5 rounded-xl border border-danger/30 p-4 text-sm text-danger">{operationError}</p>}
          {user && configured && !error && !authLoading && !loading && !accountAccess.fullAccess && <div className="mt-6 border-t border-border pt-5">
            <p className="text-sm font-medium">{entitlement.active ? "Управление подпиской" : "Уже оформляли подписку?"}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">Проверьте доступ к покупкам этого аккаунта. Повторная оплата не нужна.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {nativeBilling && emailVerified && <Button variant="outline" className="h-auto min-h-11 whitespace-normal py-2" disabled={Boolean(busy)} onClick={() => { void runOperation("restore"); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />{busy === "restore" ? "Восстанавливаем…" : "Восстановить покупки"}</Button>}
              <Button variant="ghost" className="min-h-11" disabled={Boolean(busy)} onClick={() => { void runOperation("refresh"); }}><RotateCcw className={"h-4 w-4 " + (busy === "refresh" ? "animate-spin" : "")} aria-hidden="true" />{busy === "refresh" ? "Проверяем…" : "Обновить статус"}</Button>
            </div>
          </div>}
        </div>
      </div>
      <section id="free-topics" aria-labelledby="free-topics-title" className="mt-12 scroll-mt-24 border-t border-border pt-8 sm:mt-16 sm:pt-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="free-topics-title" className="text-2xl font-semibold">Попробуйте бесплатно</h2><p className="mt-2 text-sm text-muted">Выберите тему и начните прямо сейчас.</p></div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Check className="h-4 w-4 text-success" aria-hidden="true" />Без регистрации и оплаты</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {freeTopics.map(({ slug, title, label, icon: Icon, color }) => (
            <Link key={slug} to={"/topic/" + slug} className="group flex min-h-24 items-center gap-3 rounded-2xl border border-border bg-surface/70 p-4 transition-colors hover:border-accent/50 hover:bg-surface-2">
              <span className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-xl " + color}><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-xs text-muted">{label}</span><span className="mt-1 block text-sm font-medium leading-snug">{title}</span></span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="subscription-faq-title" className="mt-10 grid gap-5 border-t border-border pt-8 sm:mt-12 lg:grid-cols-[0.65fr_1fr] lg:gap-14">
        <div><h2 id="subscription-faq-title" className="text-2xl font-semibold">Вопросы о подписке</h2><p className="mt-2 text-sm text-muted">Главное перед началом занятий.</p></div>
        <div className="min-w-0 divide-y divide-border">
          {faqs.map(({ question, answer }) => (
            <details key={question} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">{question}<ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
              <p className="pb-5 pr-5 text-sm leading-relaxed text-muted">{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-6 text-xs text-muted">
        <span>ФизЛаб 3D · Учитесь в своём темпе</span>
        <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">Условия подписки</Link>
        <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">Конфиденциальность</Link>
      </footer>
    </div>
  );
}
