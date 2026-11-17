import { PasswordInput } from "@/components/auth/PasswordInput";
import { MIN_PASSWORD_LENGTH, passwordFeedback, passwordStrength } from "../../../server/passwordPolicy.mjs";

interface Props {
  password: string;
  onPassword: (value: string) => void;
  confirmation: string;
  onConfirmation: (value: string) => void;
  identity: { email?: string; firstName?: string; lastName?: string };
}

export function PasswordSetup({ password, onPassword, confirmation, onConfirmation, identity }: Props) {
  const strength = passwordStrength(password, identity);
  const feedback = password ? passwordFeedback(password, identity) : null;
  return (
    <>
      <PasswordInput label="Новый пароль" name="new-password" value={password} onChange={event => onPassword(event.target.value)} placeholder="Новый пароль (от 8 символов)" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} required />
      <div aria-live="polite" className="text-xs text-muted">
        <div className="mb-1 flex justify-between"><span>Надёжность пароля</span><span>{strength.label}</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full transition-all ${strength.score >= 3 ? "bg-accent" : strength.score === 2 ? "bg-amber-400" : "bg-danger"}`} style={{ width: `${strength.score * 25}%` }} /></div>
        <p className="mt-1">{feedback || "Подойдёт длинная необычная фраза. Можно использовать пробелы."}</p>
      </div>
      <PasswordInput label="Повторите пароль" name="password-confirmation" value={confirmation} onChange={event => onConfirmation(event.target.value)} placeholder="Повторите пароль" autoComplete="new-password" maxLength={128} visibilityLabel="подтверждение пароля" required />
      {confirmation && password !== confirmation && <p role="alert" className="text-sm text-danger">Пароли не совпадают.</p>}
    </>
  );
}
