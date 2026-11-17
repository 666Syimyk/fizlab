import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  PURCHASES_ERROR_CODE,
  RECURRENCE_MODE,
  type SubscriptionOption,
} from "@revenuecat/purchases-capacitor";
import { runAuthMutation } from "@/lib/authMutations";
import { supabase } from "@/lib/supabaseClient";

export type BillingPlan = {
  id: "monthly" | "annual";
  title: string;
  price: string;
  priceAmount: number;
  currency: string;
  period: "P1M" | "P1Y";
};

type PlanSelection = { plan: BillingPlan; option: SubscriptionOption };
const productId = "fizlab_pro";
const apiKey = String(import.meta.env.VITE_REVENUECAT_GOOGLE_API_KEY || "").trim();
let displayedPlans: { userId: string; loadedAt: number; selections: PlanSelection[] } | undefined;

export function billingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
    && /^goog_[A-Za-z0-9]+$/.test(apiKey);
}

/** Fixed Google Play destination; never follow a provider-supplied arbitrary URL. */
export function getManageSubscriptionsUrl(): string {
  return "https://play.google.com/store/account/subscriptions?sku=fizlab_pro&package=app.fizlab.course";
}

export class BillingError extends Error {
  readonly code: "cancelled" | "pending" | "unavailable" | "account" | "failed";

  constructor(message: string, code: BillingError["code"] = "failed") {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}

function safeError(error: unknown): BillingError {
  if (error instanceof BillingError) return error;
  const details = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const code = String(details.code ?? "");
  if (details.userCancelled === true || code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
    return new BillingError("Покупка отменена. Подписка не оформлена.", "cancelled");
  }
  if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
    return new BillingError("Платёж ожидает подтверждения Google Play. После оплаты обновите статус подписки.", "pending");
  }
  if (code === PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR
    || code === PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR) {
    return new BillingError("Эта покупка связана с другим аккаунтом ФизЛаб. Войдите в аккаунт, в котором оформляли подписку.", "account");
  }
  if (code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
    return new BillingError("Подписка уже оформлена. Нажмите «Восстановить покупки» или откройте управление подпиской.");
  }
  if ([PURCHASES_ERROR_CODE.NETWORK_ERROR, PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR,
    PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR].some(value => value === code)) {
    return new BillingError("Не удалось связаться с магазином. Проверьте интернет и повторите попытку.");
  }
  return new BillingError("Магазин пока не может выполнить операцию. Попробуйте позже или обратитесь в поддержку.");
}

async function identify(userId: string): Promise<void> {
  if (!billingAvailable()) throw new BillingError("Оплата доступна в Android-приложении из Google Play после подключения магазина.", "unavailable");
  const { data, error } = await supabase.auth.getSession();
  if (error || !userId || data.session?.user.id !== userId) {
    throw new BillingError("Войдите в свой аккаунт, чтобы оформить или восстановить подписку.", "account");
  }
  const configured = await Purchases.isConfigured();
  if (!configured.isConfigured) {
    // Never create an anonymous purchaser. Purchases stay attached to the account's UUID.
    await Purchases.configure({ apiKey, appUserID: userId,
      automaticDeviceIdentifierCollectionEnabled: false, diagnosticsEnabled: false });
  } else {
    const current = await Purchases.getAppUserID();
    if (current.appUserID !== userId) {
      displayedPlans = undefined;
      await Purchases.logIn({ appUserID: userId });
    }
  }
}

/** The auth lock also blocks logout/account changes while the native payment sheet is open. */
function withAccount<T>(userId: string, action: () => Promise<T>): Promise<T> {
  return runAuthMutation(async () => {
    try {
      await identify(userId);
      return await action();
    } catch (error) {
      throw safeError(error);
    }
  });
}

async function fetchPlans(userId: string): Promise<BillingPlan[]> {
  displayedPlans = undefined;
  const { current } = await Purchases.getOfferings();
  const selections: PlanSelection[] = [];
  for (const id of ["monthly", "annual"] as const) {
    const period = id === "monthly" ? "P1M" : "P1Y";
    const option = current?.[id]?.product.subscriptionOptions?.find(candidate =>
      candidate.productId === productId && candidate.id === id && candidate.isBasePlan
      && !candidate.isPrepaid && !candidate.installmentsInfo
      && candidate.pricingPhases.length === 1
      && candidate.pricingPhases[0].billingPeriod.iso8601 === period
      && candidate.pricingPhases[0].recurrenceMode === RECURRENCE_MODE.INFINITE_RECURRING);
    const phase = option?.pricingPhases[0];
    if (!option || !phase || !phase.price.formatted || !phase.price.currencyCode
      || !Number.isFinite(phase.price.amountMicros) || phase.price.amountMicros <= 0) continue;
    selections.push({ option, plan: { id, period,
      title: id === "monthly" ? "На месяц" : "На год",
      price: phase.price.formatted,
      priceAmount: phase.price.amountMicros / 1_000_000,
      currency: phase.price.currencyCode,
    } });
  }
  displayedPlans = { userId, loadedAt: Date.now(), selections };
  return selections.map(({ plan }) => ({ ...plan }));
}

export function loadBillingPlans(userId: string): Promise<BillingPlan[]> {
  return withAccount(userId, () => fetchPlans(userId));
}

export function purchasePlan(userId: string, planId: BillingPlan["id"]): Promise<void> {
  return withAccount(userId, async () => {
    const selection = displayedPlans?.userId === userId
      ? displayedPlans.selections.find(({ plan }) => plan.id === planId) : undefined;
    if (!selection || !displayedPlans || Date.now() - displayedPlans.loadedAt > 5 * 60_000) {
      throw new BillingError("Обновите страницу подписки, чтобы получить актуальную цену магазина.", "unavailable");
    }
    // Buy precisely the base plan whose price was displayed, never an SDK-selected trial/offer.
    await Purchases.purchaseSubscriptionOption({ subscriptionOption: selection.option });
    // The caller must ask our authenticated backend to verify access. SDK success is not entitlement.
  });
}

export function restorePurchases(userId: string): Promise<void> {
  return withAccount(userId, async () => {
    await Purchases.restorePurchases();
  });
}
