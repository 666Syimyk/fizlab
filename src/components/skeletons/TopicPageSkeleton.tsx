import { Skeleton } from "./Skeleton";

export function TopicPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <Skeleton className="mb-6 h-4 w-32" />
      <Skeleton className="mb-2 h-9 w-72" />
      <Skeleton className="mb-8 h-5 w-96 max-w-full" />
      <Skeleton className="mb-4 h-11 w-full max-w-xl" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}
