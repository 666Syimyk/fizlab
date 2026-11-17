import { useEffect } from "react";

const BASE_TITLE = "ФизЛаб 3D";

/** Sets document.title to `${title} — ФизЛаб 3D` (or just the base title) while mounted. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [title]);
}
