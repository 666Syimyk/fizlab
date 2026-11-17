import { Skeleton } from "./Skeleton";

export function SectionPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Skeleton className="mb-8 h-4 w-24" />
      <Skeleton className="mb-2 h-9 w-64" />
      <Skeleton className="mb-10 h-5 w-96 max-w-full" />
      <div className="overflow-hidden rounded-2xl border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-border p-5 last:border-b-0">
            <Skeleton className="h-5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
