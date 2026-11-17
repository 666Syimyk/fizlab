export type EventType = "topic_opened" | "problem_solved" | "sim_started";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; first_name?: string; last_name?: string; full_name: string; avatar_data?: string | null; role: "student"; status: "approved"; university_id: null; created_at: string };
        Insert: { id: string; first_name?: string; last_name?: string; full_name: string; avatar_data?: string | null; role?: "student"; status?: "approved"; university_id?: null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      progress: {
        Row: { user_id: string; solved_problem_ids: Record<string, string[]>; completed_topic_slugs?: string[]; updated_at: string };
        Insert: { user_id: string; solved_problem_ids?: Record<string, string[]>; completed_topic_slugs?: string[]; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["progress"]["Insert"]>;
        Relationships: [];
      };
      events: {
        Row: { id: string; user_id: string; type: EventType; topic_slug: string | null; created_at: string };
        Insert: { id?: string; user_id: string; type: EventType; topic_slug?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AnalyticsEvent = Database["public"]["Tables"]["events"]["Row"];
export type ProgressRow = Database["public"]["Tables"]["progress"]["Row"];
