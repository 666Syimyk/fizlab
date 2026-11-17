import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";

export function ComingSoon({
  icon: Icon = Clock,
  text,
}: {
  icon?: LucideIcon;
  text: string;
}) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
      <Icon className="h-8 w-8 text-muted-2" />
      <p className="text-muted">{text}</p>
    </div>
  );
}
