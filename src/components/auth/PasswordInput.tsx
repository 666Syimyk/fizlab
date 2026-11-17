import { useId, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<"input">, "type"> & {
  visibilityLabel?: string;
  label?: string;
};

export function PasswordInput({ className, visibilityLabel = "пароль", label, id, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div>
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium">{label ?? props.placeholder ?? "Пароль"}</label>
      <div className="relative">
      <Input {...props} id={inputId} type={visible ? "text" : "password"} className={cn("pr-11", className)} />
      <button
        type="button"
        className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={visible ? `Скрыть ${visibilityLabel}` : `Показать ${visibilityLabel}`}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible(value => !value)}
      >
        {visible ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
      </button>
      </div>
    </div>
  );
}
