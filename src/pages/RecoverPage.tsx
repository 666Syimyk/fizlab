import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Mail, ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { PasswordSetup } from "@/components/auth/PasswordSetup";
import { RecoveryCodeCard } from "@/components/auth/RecoveryCodeCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authPost, getAuthSettings, type AuthApiError } from "@/lib/authApi";
import { runAuthMutation } from "@/lib/authMutations";
import { authErrorMessage } from "@/lib/authError";
import { supabase } from "@/lib/supabaseClient";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { passwordFeedback } from "../../server/passwordPolicy.mjs";

type RecoveryResult = { access_token: string; refresh_token: string; recovery_code: string };
type ResetResult = { success: boolean; recovery_code: string };
type ResetGrant = { token: string; expiresAt: number };
type Step = "email" | "code" | "password" | "success";
const labels = ["Почта", "Код", "Новый пароль"];
const normalEmail = (value: string) => value.trim().toLowerCase();
const secondsText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function RecoverPage() {
  useDocumentTitle("Восстановление пароля");
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [nextCode, setNextCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [mode, setMode] = useState<"email" | "backup">("email");
  const [step, setStep] = useState<Step>("email");
  const [grant, setGrant] = useState<ResetGrant | null>(null);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldowns = useRef(new Map<string, number>());
  const submitLock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const stageIndex = step === "email" ? 0 : step === "code" ? 1 : 2;

  useEffect(() => {
    let active = true;
    void getAuthSettings().then(settings => {
      if (active) setEmailAvailable(settings.email_recovery_available);
    }, () => { if (active) setEmailAvailable(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!resendAt && !grant) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt, grant]);

  useEffect(() => {
    if (busy) return;
    if (step === "success") successRef.current?.focus();
    else formRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
  }, [mode, step, busy]);

  useEffect(() => {
    if (!grant || now < grant.expiresAt || busy) return;
    setGrant(null);
    setPassword("");
    setConfirmation("");
    setStep("code");
    setNotice("");
    setError("Время для смены пароля истекло. Запросите новый код.");
  }, [grant, now, busy]);

  function clearSecrets() {
    setCode("");
    setPassword("");
    setConfirmation("");
    setGrant(null);
    setError("");
    setNotice("");
  }

  function changeMode(next: "email" | "backup") {
    clearSecrets();
    setMode(next);
    setStep("email");
  }

  function editEmail() {
    clearSecrets();
    setStep("email");
  }

  function startCooldown(seconds: number) {
    const until = Date.now() + Math.max(1, seconds) * 1000;
    cooldowns.current.set(normalEmail(email), until);
    setResendAt(until);
    setNow(Date.now());
  }

  async function requestCode() {
    if (submitLock.current) return;
    const remaining = Math.ceil(((cooldowns.current.get(normalEmail(email)) || 0) - Date.now()) / 1000);
    if (remaining > 0) {
      setResendAt(cooldowns.current.get(normalEmail(email))!);
      setNow(Date.now());
      setStep("code");
      return;
    }
    submitLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await authPost<{ message: string; resend_after_seconds: number }>("request-email-reset", { email: normalEmail(email) });
      clearSecrets();
      setEmail(normalEmail(email));
      setNotice(result.message);
      startCooldown(Number.isFinite(result.resend_after_seconds) ? result.resend_after_seconds : 120);
      setStep("code");
    } catch (cause) {
      const failure = cause as AuthApiError;
      if (failure.status === 429 && failure.resendAfterSeconds) {
        startCooldown(failure.resendAfterSeconds);
        setStep("code");
      }
      setError(cause instanceof Error ? cause.message : "Не удалось запросить письмо. Попробуйте позже.");
    } finally { submitLock.current = false; setBusy(false); }
  }

  async function verifyCode() {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await authPost<{ reset_token: string; expires_in: number }>("verify-email-reset", { email: normalEmail(email), code: code.trim() });
      if (!result.reset_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error("Не удалось подтвердить код. Запросите новый.");
      setGrant({ token: result.reset_token, expiresAt: Date.now() + result.expires_in * 1000 });
      setCode("");
      setNotice("");
      setNow(Date.now());
      setStep("password");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось проверить код. Попробуйте ещё раз."); }
    finally { submitLock.current = false; setBusy(false); }
  }

  async function savePassword() {
    if (submitLock.current) return;
    const feedback = passwordFeedback(password, { email });
    if (feedback) { setError(feedback); return; }
    if (password !== confirmation) { setError(""); return; }
    if (mode === "email" && (!grant || grant.expiresAt <= Date.now())) {
      clearSecrets();
      setStep("code");
      setError("Время для смены пароля истекло. Запросите новый код.");
      return;
    }
    setBusy(true);
    submitLock.current = true;
    setError("");
    let issued = false;
    try {
      await runAuthMutation(async () => {
        if (mode === "email") {
          const result = await authPost<ResetResult>("reset-password", {
            email: normalEmail(email), reset_token: grant!.token, password, password_confirmation: confirmation,
          });
          if (!result.success) throw new Error("Не удалось сменить пароль. Попробуйте ещё раз.");
          setNextCode(result.recovery_code);
          clearSecrets();
          setStep("success");
          return;
        }
        const result = await authPost<RecoveryResult>("recover", {
          email: normalEmail(email), recovery_code: code.trim(), password, password_confirmation: confirmation,
        });
        setNextCode(result.recovery_code);
        issued = true;
        clearSecrets();
        const { error: sessionError } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
        if (sessionError) throw sessionError;
        setSessionReady(true);
      });
    } catch (cause) {
      const failure = cause as AuthApiError;
      if (mode === "email" && failure.code === "reset_token_expired") {
        clearSecrets();
        setStep("code");
      }
      setError(issued ? "Пароль изменён, но автоматический вход не завершился. Сохраните новый код и войдите с новым паролем."
        : cause instanceof Error && "status" in cause ? cause.message : authErrorMessage(cause));
    } finally { submitLock.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "email" && step === "email") await requestCode();
    else if (mode === "email" && step === "code") await verifyCode();
    else await savePassword();
  }

  const title = mode === "backup" ? "Восстановить аккаунт" : step === "success" ? "Пароль изменён" : step === "password" ? "Придумайте новый пароль" : step === "code" ? "Введите код из письма" : "Забыли пароль?";
  const description = mode === "backup" ? "Введите почту аккаунта и сохранённый резервный код." : step === "success" ? "Теперь вы можете войти в аккаунт с новым паролем. Прежние сеансы завершены." : step === "password" ? "Код подтверждён. Введите новый пароль и повторите его." : step === "code" ? "Введите одноразовый код из письма. Если письма нет, проверьте папку «Спам»." : "Укажите электронную почту, привязанную к аккаунту. Мы отправим на неё одноразовый код.";

  return (
    <AuthLayout title={title} description={description}>
      {mode === "email" && step !== "success" && <ol aria-label="Шаги восстановления" className="grid grid-cols-3 gap-2 border-b border-border pb-5">
        {labels.map((label, index) => <li key={label} aria-current={stageIndex === index ? "step" : undefined} className={`flex min-w-0 flex-col items-center gap-2 text-center text-xs ${stageIndex >= index ? "text-accent" : "text-muted"}`}>
          <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full ${stageIndex >= index ? "bg-accent/15" : "bg-surface-2"}`}>{stageIndex > index ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
          {label}
        </li>)}
      </ol>}

      {mode === "email" && step === "success" ? <div ref={successRef} tabIndex={-1} className="space-y-5 outline-none">
        <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent"><ShieldCheck className="h-6 w-6" /></div>
        <Button asChild variant="accent" className="w-full"><Link to="/login" replace>Перейти ко входу</Link></Button>
        {nextCode && <details className="rounded-xl border border-border p-4 text-sm">
          <summary className="cursor-pointer font-medium">Резервный код доступа</summary>
          <p className="mt-3 text-muted">При желании сохраните новый резервный код в надёжном месте. Он поможет, если доступа к почте не будет. Прежний резервный код больше не действует.</p>
          <code className="mt-3 block break-all rounded-lg bg-surface-2 p-3 text-center font-semibold select-all">{nextCode}</code>
        </details>}
      </div> : mode === "backup" && nextCode ? <RecoveryCodeCard code={nextCode} disabled={busy} onContinue={() => navigate(sessionReady ? "/" : "/login", { replace: true })} /> : (
        <form ref={formRef} onSubmit={submit} aria-busy={busy} className="flex flex-col gap-3">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3">
            {(mode === "backup" || step === "email") ? <>
              <label htmlFor="recover-email" className="text-sm font-medium">Электронная почта</label>
              <Input id="recover-email" name="email" value={email} onChange={event => {
                clearSecrets();
                setEmail(event.target.value);
                setResendAt(cooldowns.current.get(normalEmail(event.target.value)) || 0);
                setNow(Date.now());
              }} type="email" placeholder="Email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required />
              {mode === "email" && emailAvailable === false && <p role="status" className="text-sm text-muted">Отправка писем временно недоступна. Попробуйте позже.</p>}
            </> : <div className="flex min-w-0 items-start gap-2 rounded-lg bg-surface-2 p-3 text-sm">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0"><p className="break-all">{normalEmail(email)}</p><button type="button" className="mt-1 text-accent hover:underline" onClick={editEmail}>Изменить email</button></div>
            </div>}

            {(mode === "backup" || step === "code") && <>
              <label htmlFor="recover-code" className="text-sm font-medium">{mode === "email" ? "Код из письма" : "Резервный код"}</label>
              <Input id="recover-code" name="recovery-code" value={code} onChange={event => { setCode(mode === "email" ? event.target.value.replace(/\D/g, "") : event.target.value); setError(""); }} placeholder={mode === "email" ? "8 цифр из письма" : "Резервный код"} inputMode={mode === "email" ? "numeric" : "text"} autoComplete={mode === "email" ? "one-time-code" : "off"} autoCapitalize="none" spellCheck={false} pattern={mode === "email" ? "[0-9]{8}" : undefined} maxLength={mode === "email" ? 8 : 64} required aria-describedby={mode === "email" ? "recover-code-hint" : undefined} />
              {mode === "email" && <p id="recover-code-hint" className="text-xs text-muted">Код действует 15 минут. После пяти неверных попыток понадобится новый.</p>}
            </>}

            {(mode === "backup" || step === "password") && <PasswordSetup password={password} onPassword={setPassword} confirmation={confirmation} onConfirmation={setConfirmation} identity={{ email }} />}
            {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" variant="accent" disabled={busy}>{busy ? "Подождите…" : mode === "backup" || step === "password" ? "Сменить пароль" : step === "code" ? "Подтвердить код" : "Получить код на email"}</Button>
            {mode === "email" && step === "code" && <Button type="button" variant="ghost" className="h-auto min-h-10 whitespace-normal" disabled={busy || resendSeconds > 0} onClick={() => void requestCode()}>{resendSeconds > 0 ? `Отправить ещё раз через ${secondsText(resendSeconds)}` : "Отправить код ещё раз"}</Button>}
          </fieldset>
        </form>
      )}

      {mode === "backup" && nextCode && error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!nextCode && <>
        <p className="text-center text-sm text-muted"><Link to="/login" className="text-accent hover:underline">Вернуться ко входу</Link></p>
        {(mode === "backup" || step === "email") && <button type="button" disabled={busy} className="text-center text-xs text-muted underline-offset-4 hover:underline disabled:opacity-50" onClick={() => changeMode(mode === "email" ? "backup" : "email")}>{mode === "email" ? "Использовать резервный код" : "Восстановить через почту"}</button>}
      </>}
    </AuthLayout>
  );
}
