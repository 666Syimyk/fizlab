import { Skeleton } from "./Skeleton";

export function HomePageSkeleton() {
  return (
    <div>
      <div className="flex h-[100svh] flex-col items-center justify-center gap-4 bg-background">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-16 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto mb-14 flex max-w-md items-center justify-center gap-10">
          <Skeleton className="h-14 w-16" />
          <Skeleton className="h-14 w-16" />
          <Skeleton className="h-14 w-16" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    </div>
  );
}
