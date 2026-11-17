import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, LogOut, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import { sections } from "@/data/sections";
import { cn } from "@/lib/utils";
import { SearchBox } from "@/components/SearchBox";
import { useAuth } from "@/components/AuthProvider";
import { useAccountAccess } from "@/components/AccountAccessProvider";
import { Button } from "@/components/ui/button";

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const headerRef = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const logoutLock = useRef(false);
  const { user, loading, signOut } = useAuth();
  const { isSuperadmin } = useAccountAccess();

  useEffect(() => { setOpen(false); setSignOutError(""); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  async function logout() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setSigningOut(true);
    setSignOutError("");
    try { await signOut(); navigate("/"); }
    catch { setSignOutError("Не удалось выйти. Попробуйте ещё раз."); }
    finally { logoutLock.current = false; setSigningOut(false); }
  }

  return (
    <header ref={headerRef} className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          to="/"
          aria-label="ФизЛаб 3D — главная"
          className="flex shrink-0 items-center gap-2 font-display text-base font-bold tracking-tight"
          onClick={() => setOpen(false)}
        >
          <img src="/icons/logo-128.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
          <span className="hidden sm:inline">ФизЛаб 3D</span>
        </Link>

        <SearchBox className="min-w-0 max-w-md flex-1" />

        <Link to="/subscription" aria-label="Подписка ФизЛаб Плюс" aria-current={location.pathname === "/subscription" ? "page" : undefined} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent/10 px-2 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">Плюс</span>
        </Link>

        <button
          ref={menuButton}
          type="button"
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2",
            open && "bg-surface-2",
          )}
          onClick={() => setOpen((v) => !v)}
          aria-label="Разделы курса"
          aria-expanded={open}
          aria-controls="course-sections"
        >
          {open ? <X className="h-4.5 w-4.5" /> : <LayoutGrid className="h-4.5 w-4.5" />}
          <span className="hidden sm:inline">Разделы</span>
        </button>

        {user && (
          <Link
            to="/account"
            aria-label="Личный кабинет"
            aria-current={location.pathname.startsWith("/account") ? "page" : undefined}
            className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            <UserRound className="h-5 w-5" />
            <span className="hidden lg:inline">Личный кабинет</span>
          </Link>
        )}

        {loading ? <span role="status" aria-label="Проверка входа" className="h-8 w-16" /> : user ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            aria-label={signingOut ? "Выходим" : "Выйти"}
            disabled={signingOut}
            onClick={() => { void logout(); }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        ) : (
          <Button asChild size="sm" variant="accent" className="shrink-0">
            <Link to="/login">Войти</Link>
          </Button>
        )}
      </div>
      {signOutError && <p role="alert" className="px-4 pb-2 text-center text-sm text-danger">{signOutError}</p>}

      <AnimatePresence>
        {open && (
          <motion.nav
            id="course-sections"
            aria-label="Разделы курса"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="mx-auto grid max-h-[calc(100dvh-4rem)] max-w-6xl grid-cols-1 gap-1 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-3">
              {isSuperadmin && <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-accent hover:bg-surface-2"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Панель администратора</Link>}
              {sections.map((section) => (
                <Link
                  key={section.id}
                  to={`/section/${section.id}`}
                  onClick={() => setOpen(false)}
                  aria-current={location.pathname === `/section/${section.id}` ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground",
                    location.pathname === `/section/${section.id}` && "bg-surface-2 text-foreground",
                  )}
                >
                  {section.title}
                </Link>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
