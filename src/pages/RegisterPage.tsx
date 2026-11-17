import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { authNext } from "@/lib/authRedirect";
import { supabase } from "@/lib/supabaseClient";
import { authPost } from "@/lib/authApi";
import { runAuthMutation } from "@/lib/authMutations";
import { authErrorMessage } from "@/lib/authError";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { PasswordSetup } from "@/components/auth/PasswordSetup";
import { RecoveryCodeCard } from "@/components/auth/RecoveryCodeCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { passwordFeedback } from "../../server/passwordPolicy.mjs";

type SignupResult = { access_token: string; refresh_token: string; recovery_code: string };

export function RegisterPage() {
  useDocumentTitle("Регистрация");
  const navigate = useNavigate();
  const location = useLocation();
  const next = authNext(location.search);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const submitLock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    if (!firstName.trim() || !lastName.trim()) { setError("Укажите имя и фамилию."); return; }
    const feedback = passwordFeedback(password, { email, firstName, lastName });
    if (feedback) { setError(feedback); return; }
    if (password !== confirmation) { setError("Пароли не совпадают."); return; }
    setSubmitting(true);
    submitLock.current = true;
    setError(null);
    let issued = false;
    try {
      await runAuthMutation(async () => {
      const result = await authPost<SignupResult>("signup", {
        email: email.trim(), password, password_confirmation: confirmation,
        data: { first_name: firstName.trim(), last_name: lastName.trim() },
      });
      setRecoveryCode(result.recovery_code);
      issued = true;
      setPassword("");
      setConfirmation("");
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.access_token, refresh_token: result.refresh_token,
      });
      if (sessionError) throw sessionError;
      setSessionReady(true);
      });
    } catch (cause) {
      setError(issued ? "Аккаунт создан, но автоматический вход не завершился. Сохраните код и войдите с новым паролем." : authErrorMessage(cause));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Создать аккаунт" description="Сохраняйте личный прогресс и возвращайтесь к задачам. Вход на новом устройстве завершит предыдущую сессию.">
      {recoveryCode ? <RecoveryCodeCard code={recoveryCode} disabled={submitting} onContinue={() => navigate(sessionReady ? next : `/login${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`, { replace: true })} /> : (
        <form onSubmit={submit} aria-busy={submitting} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium">Имя<Input name="given-name" value={firstName} onChange={event => setFirstName(event.target.value)} placeholder="Имя" autoComplete="given-name" maxLength={100} required /></label>
            <label className="flex flex-col gap-2 text-sm font-medium">Фамилия<Input name="family-name" value={lastName} onChange={event => setLastName(event.target.value)} placeholder="Фамилия" autoComplete="family-name" maxLength={100} required /></label>
          </div>
          <label htmlFor="register-email" className="text-sm font-medium">Email</label>
          <Input id="register-email" name="email" value={email} onChange={event => setEmail(event.target.value)} type="email" placeholder="Email" autoComplete="email" maxLength={254} required />
          <PasswordSetup password={password} onPassword={setPassword} confirmation={confirmation} onConfirmation={setConfirmation} identity={{ email, firstName, lastName }} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Создаём аккаунт…" : "Зарегистрироваться"}</Button>
        </form>
      )}
      {recoveryCode && error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!recoveryCode && <p className="text-center text-sm text-muted">Уже есть аккаунт? <Link to={`/login${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`} className="text-accent hover:underline">Войти</Link></p>}
      <p className="text-center text-xs text-muted">Ознакомьтесь с <Link to="/privacy" className="text-accent underline">обработкой данных</Link>.</p>
    </AuthLayout>
  );
}
