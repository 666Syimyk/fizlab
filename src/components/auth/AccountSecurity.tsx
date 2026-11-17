import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { authPost, getAuthSettings } from "@/lib/authApi";
import { runAuthMutation } from "@/lib/authMutations";
import { supabase } from "@/lib/supabaseClient";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordSetup } from "@/components/auth/PasswordSetup";
import { RecoveryCodeCard } from "@/components/auth/RecoveryCodeCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passwordFeedback } from "../../../server/passwordPolicy.mjs";

type PasswordResult = { access_token: string; refresh_token: string; recovery_code: string };

export function AccountSecurity({ user }: { user: User }) {
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [verified, setVerified] = useState(Boolean(user.email_confirmed_at));
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void getAuthSettings().then(settings => { if (active.current) setEmailAvailable(settings.email_verification_available); }, () => { if (active.current) setEmailAvailable(false); });
    return () => { active.current = false; };
  }, []);

  async function accessToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !active.current || data.session?.user.id !== user.id) throw new Error("Сессия завершена. Войдите снова.");
    return data.session.access_token;
  }

  async function emailAction(confirm = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setEmailError("");
    setEmailMessage("");
    try {
      await runAuthMutation(async () => {
        const token = await accessToken();
        const result = await authPost<{ message?: string }>(confirm ? "verify-email" : "request-email-verification", confirm ? { code } : {}, token);
        if (!active.current) return;
        if (confirm) {
          setVerified(true);
          setCode("");
          const { error } = await supabase.auth.refreshSession();
          setEmailMessage(error ? "Email подтверждён. Обновите страницу, чтобы обновить статус аккаунта." : "Email подтверждён.");
        } else {
          setCodeRequested(true);
          setEmailMessage(result.message || "Проверьте почту.");
        }
      });
    } catch (cause) {
      if (active.current) setEmailError(cause instanceof Error ? cause.message : "Не удалось подтвердить email.");
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const feedback = passwordFeedback(password, { email: user.email, firstName: user.user_metadata?.first_name, lastName: user.user_metadata?.last_name });
    if (feedback) { setPasswordError(feedback); return; }
    if (password !== confirmation) { setPasswordError("Пароли не совпадают."); return; }
    lock.current = true;
    setBusy(true);
    setPasswordError("");
    let changed = false;
    try {
      await runAuthMutation(async () => {
        const token = await accessToken();
        const result = await authPost<PasswordResult>("change-password", { current_password: currentPassword, password, password_confirmation: confirmation }, token);
        changed = true;
        if (!active.current) return;
        setBackupCode(result.recovery_code);
        setCurrentPassword(""); setPassword(""); setConfirmation("");
        const { error } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
        if (error) throw error;
      });
    } catch (cause) {
      if (active.current) setPasswordError(changed ? "Пароль изменён. Сохраните новый резервный код и войдите снова с новым паролем." : cause instanceof Error ? cause.message : "Не удалось сменить пароль.");
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }

  return <>
    <section className="mt-8 rounded-2xl border border-border p-6" aria-labelledby="email-security-heading">
      <h2 id="email-security-heading" className="mb-2 text-xl font-semibold">Подтверждение email</h2>
      {verified || user.email_confirmed_at ? <p className="text-sm text-success [overflow-wrap:anywhere]">Email подтверждён: {user.email}</p> : <>
        <p className="mb-4 text-sm text-muted [overflow-wrap:anywhere]">Подтвердите {user.email}, чтобы защитить аккаунт и восстанавливать доступ через почту.</p>
        {emailAvailable === null ? <p role="status" className="text-sm text-muted">Проверяем доступность писем…</p> : emailAvailable ? <div className="space-y-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void emailAction()}>{codeRequested ? "Отправить новый код" : "Получить код на email"}</Button>
          {codeRequested && <form onSubmit={event => { event.preventDefault(); void emailAction(true); }} className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="verification-code">Код из письма</label>
            <Input id="verification-code" name="verification-code" placeholder="8 цифр из письма" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} required />
            <p className="text-xs text-muted">Код действует 15 минут. После пяти ошибок запросите новый.</p>
            <Button type="submit" variant="accent" disabled={busy}>{busy ? "Проверяем…" : "Подтвердить email"}</Button>
          </form>}
        </div> : <p className="text-sm text-muted">Отправка писем пока недоступна. Сохраните резервный код для восстановления доступа.</p>}
      </>}
      {emailMessage && <p role="status" className="mt-3 text-sm text-muted">{emailMessage}</p>}
      {emailError && <p role="alert" className="mt-3 text-sm text-danger">{emailError}</p>}
    </section>
    <section className="mt-8 rounded-2xl border border-border p-6" aria-labelledby="password-security-heading">
      <h2 id="password-security-heading" className="mb-2 text-xl font-semibold">Сменить пароль</h2>
      <p className="mb-4 text-sm text-muted">После смены пароля прежние сеансы и резервный код перестанут действовать. Сохраните новый код.</p>
      {backupCode ? <RecoveryCodeCard code={backupCode} disabled={busy} onContinue={() => setBackupCode("")} /> : <form onSubmit={changePassword} className="flex flex-col gap-3" aria-busy={busy}>
        <PasswordInput label="Действующий пароль" name="current-password" autoComplete="current-password" placeholder="Действующий пароль для смены" maxLength={256} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required />
        <PasswordSetup password={password} onPassword={setPassword} confirmation={confirmation} onConfirmation={setConfirmation} identity={{ email: user.email }} />
        <Button type="submit" variant="outline" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить новый пароль"}</Button>
      </form>}
      {passwordError && <p role="alert" className="mt-3 text-sm text-danger">{passwordError}</p>}
    </section>
  </>;
}
