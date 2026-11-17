import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { allTopicsFlat } from "@/data/sections";
import { contentIndex } from "@/data/contentIndex";
import { cn } from "@/lib/utils";

interface SearchResult {
  slug: string;
  title: string;
  sectionTitle: string;
  /** which heading matched, if the match wasn't in the title/summary */
  matchedHeading?: string;
}

export function SearchBox({ className }: { className?: string }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const resultsId = useId();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const t of allTopicsFlat()) {
      const entry = contentIndex[t.slug];
      if (t.title.toLowerCase().includes(q)) {
        out.push({ slug: t.slug, title: t.title, sectionTitle: t.sectionTitle });
        continue;
      }
      if (entry?.summary.toLowerCase().includes(q)) {
        out.push({ slug: t.slug, title: t.title, sectionTitle: t.sectionTitle });
        continue;
      }
      const heading = entry?.headings.find((h) => h.toLowerCase().includes(q));
      if (heading) {
        out.push({ slug: t.slug, title: t.title, sectionTitle: t.sectionTitle, matchedHeading: heading });
      }
    }
    return out.slice(0, 8);
  }, [query]);

  function goTo(slug: string) {
    navigate(`/topic/${slug}`);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }

  return (
    <div className={cn("relative", className)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 transition-colors focus-within:border-accent sm:px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-2" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); setFocused(true); }}
          onFocus={() => setFocused(true)}
          role="combobox"
          aria-label="Поиск по темам"
          aria-autocomplete="list"
          aria-expanded={focused && Boolean(query.trim())}
          aria-controls={resultsId}
          aria-activedescendant={focused && activeIndex >= 0 && results[activeIndex] ? `${resultsId}-${activeIndex}` : undefined}
          autoComplete="off"
          maxLength={200}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setFocused(false); setActiveIndex(-1); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
              event.preventDefault();
              setFocused(true);
              setActiveIndex((index) => event.key === "ArrowDown"
                ? (index + 1) % results.length
                : (index <= 0 ? results.length - 1 : index - 1));
            }
            if (event.key === "Enter" && focused && results.length) {
              event.preventDefault();
              goTo(results[Math.max(0, activeIndex)].slug);
            }
          }}
          placeholder="Поиск по темам…"
          className="w-full min-w-0 self-stretch bg-transparent text-sm text-foreground placeholder:text-transparent outline-none sm:placeholder:text-muted-2"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setActiveIndex(-1); inputRef.current?.focus(); }}
            aria-label="Очистить поиск"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-2 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {focused && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            id={resultsId}
            role="listbox"
            aria-label="Найденные темы"
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface shadow-xl"
          >
            {results.length === 0 ? (
              <p role="status" className="p-4 text-sm text-muted">Ничего не найдено</p>
            ) : (
              results.map((t, index) => (
                <button
                  key={t.slug}
                  id={`${resultsId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={activeIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => goTo(t.slug)}
                  className={cn("flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-2", activeIndex === index && "bg-surface-2")}
                >
                  <span className="text-sm text-foreground">{t.title}</span>
                  <span className="text-xs text-muted-2">
                    {t.sectionTitle}
                    {t.matchedHeading && ` · ${t.matchedHeading}`}
                  </span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
