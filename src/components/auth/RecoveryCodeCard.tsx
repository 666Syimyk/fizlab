import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RecoveryCodeCard({ code, disabled = false, onContinue }: { code: string; disabled?: boolean; onContinue: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <div className="space-y-4 rounded-2xl border border-accent/40 bg-surface p-5">
      <h2 className="text-xl font-semibold">Сохраните резервный код</h2>
      <p className="text-sm text-muted">С ним можно восстановить аккаунт, если вы забудете пароль. Код показывается только сейчас. Не пересылайте его другим людям.</p>
      <code className="block break-all rounded-lg bg-surface-2 p-3 text-center text-sm font-semibold tracking-wide select-all">{code}</code>
      <Button type="button" variant="outline" className="w-full" onClick={async () => {
        try { await navigator.clipboard.writeText(code); setCopied(true); setCopyError(false); }
        catch { setCopied(false); setCopyError(true); }
      }}>{copied ? "Скопировано" : "Скопировать код"}</Button>
      {copyError && <p role="status" className="text-sm text-muted">Не удалось скопировать автоматически. Выделите код выше и скопируйте вручную.</p>}
      <Button type="button" variant="accent" className="w-full" disabled={disabled} onClick={onContinue}>Я сохранил код</Button>
    </div>
  );
}
