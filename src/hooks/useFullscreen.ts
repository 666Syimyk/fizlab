import { useCallback, useEffect, useState, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const currentFullscreen = () => {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};

/** CSS that turns an ancestor into the containing block of position:fixed children */
const TRAP_RESET: Record<string, string> = { transform: "none", filter: "none", "backdrop-filter": "none", perspective: "none", contain: "none", "will-change": "auto" };

function trapsFixed(node: HTMLElement) {
  const cs = getComputedStyle(node);
  return (
    cs.transform !== "none" ||
    cs.filter !== "none" ||
    (cs.backdropFilter ?? "none") !== "none" ||
    cs.perspective !== "none" ||
    /paint|layout|strict|content/.test(cs.contain ?? "") ||
    /transform|filter|perspective/.test(cs.willChange ?? "")
  );
}

/** Lets a pinned element cover the viewport even inside animated/transformed containers; returns the undo. */
function releaseFixedTraps(element: HTMLElement | null) {
  const undo: (() => void)[] = [];
  for (let node = element?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
    if (!trapsFixed(node)) continue;
    const style = node.style;
    const saved = Object.keys(TRAP_RESET).map((prop) => [prop, style.getPropertyValue(prop), style.getPropertyPriority(prop)] as const);
    for (const [prop, value] of Object.entries(TRAP_RESET)) style.setProperty(prop, value, "important");
    undo.push(() => {
      for (const [prop, value, priority] of saved) {
        if (value) style.setProperty(prop, value, priority);
        else style.removeProperty(prop);
      }
    });
  }
  return () => undo.forEach((fn) => fn());
}

function leaveNativeFullscreen() {
  const doc = document as FullscreenDocument;
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (exit) void Promise.resolve(exit.call(doc)).catch(() => undefined);
}

/**
 * Fullscreen for one element. Uses the browser Fullscreen API where it works; on iPhone
 * Safari and inside the Android app (no element fullscreen there) the element is pinned
 * over the whole page instead, and Esc or the button brings it back.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [native, setNative] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const sync = () => {
      const on = ref.current !== null && currentFullscreen() === ref.current;
      setNative(on);
      if (on) setPinned(false);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [ref]);

  // pinned mode: cover the whole window, Esc leaves it, the page underneath must not scroll
  useEffect(() => {
    if (!pinned) return;
    const restoreTraps = releaseFixedTraps(ref.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      restoreTraps();
    };
  }, [pinned, ref]);

  // navigating away while the simulation is fullscreen
  useEffect(() => {
    const element = ref.current;
    return () => {
      if (element && currentFullscreen() === element) leaveNativeFullscreen();
    };
  }, [ref]);

  const enter = useCallback(async () => {
    const element = ref.current as FullscreenElement | null;
    if (!element) return;
    const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
    if (request && !Capacitor.isNativePlatform()) {
      // some embedded browsers never settle the request: pin the scene if nothing happened
      const fallback = window.setTimeout(() => {
        if (currentFullscreen() !== element) setPinned(true);
      }, 900);
      try {
        await request.call(element, { navigationUI: "hide" });
        window.clearTimeout(fallback);
        return;
      } catch {
        // refused (e.g. inside an iframe without permission): pin right away
        window.clearTimeout(fallback);
      }
    }
    setPinned(true);
  }, [ref]);

  const exit = useCallback(() => {
    if (native) leaveNativeFullscreen();
    setPinned(false);
  }, [native]);

  const active = native || pinned;
  const toggle = useCallback(() => {
    if (active) exit();
    else void enter();
  }, [active, enter, exit]);

  return { active, pinned, toggle };
}
