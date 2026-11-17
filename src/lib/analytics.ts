import { supabase } from "@/lib/supabaseClient";
import type { EventType } from "@/types/database";

let currentUserId: string | null = null;

export function setAnalyticsUser(userId: string | null) {
  currentUserId = userId;
}

/** Fire-and-forget event log — never throws, never blocks the UI on failure. */
export function logEvent(type: EventType, topicSlug?: string) {
  if (!currentUserId) return;
  void supabase
    .from("events")
    .insert({ user_id: currentUserId, type, topic_slug: topicSlug ?? null })
    .then(({ error }) => {
      if (error) console.warn("Аналитика: событие не записано —", error.message);
    });
}
