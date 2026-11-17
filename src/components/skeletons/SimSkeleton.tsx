import { Skeleton } from "./Skeleton";

/** Fallback shown while a topic's 3D simulation chunk is being fetched (React.lazy). */
export function SimSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[400px] sm:h-[460px] lg:h-[540px] w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
