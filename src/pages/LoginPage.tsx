import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { authNext } from "@/lib/authRedirect";
import { supabase } from "@/lib/supabaseClient";
import { authErrorMessage } from "@/lib/authError";
import { runAuthMutation } from "@/lib/authMutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function LoginPage() {
  useDocumentTitle("Вход");
  const navigate = useNavigate();
  const location = useLocation();
  const next = authNext(location.search);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await runAuthMutation(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));
      if (result.error) setError(authErrorMessage(result.error));
      else navigate(next, { replace: true });
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally { submitLock.current = false; setSubmitting(false); }
  }
  return (
    <AuthLayout title="Вход" description="Войдите, чтобы продолжить с сохранённым прогрессом. Вход на новом устройстве завершит предыдущую сессию.">
      <form onSubmit={submit} aria-busy={submitting} className="flex flex-col gap-3">
        <label htmlFor="login-email" className="text-sm font-medium">Email</label>
        <Input id="login-email" name="email" type="email" placeholder="Email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required />
        <PasswordInput label="Пароль" name="password" placeholder="Пароль" autoComplete="current-password" maxLength={256} value={password} onChange={event => setPassword(event.target.value)} required />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Входим…" : "Войти"}</Button>
      </form>
      <p className="text-center text-sm text-muted">Нет аккаунта? <Link to={`/register${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`} className="text-accent hover:underline">Зарегистрироваться</Link></p>
      <p className="text-center text-sm"><Link to="/recover" className="text-accent hover:underline">Забыли пароль?</Link></p>
    </AuthLayout>
  );
}
