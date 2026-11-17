import type { TopicModule, TopicMeta } from "@/types/topic";

export function createStub(meta: Omit<TopicMeta, "stub">): TopicModule {
  return {
    meta: { ...meta, stub: true },
    notes: [
      { type: "heading", content: meta.title },
      {
        type: "paragraph",
        content: "Конспект по этой теме готовится и появится в одном из следующих обновлений.",
      },
    ],
    history: {
      discoverer: "—",
      year: "—",
      facts: [
        {
          title: "Скоро",
          text: "Исторический раздел для этой темы находится в разработке.",
        },
      ],
    },
  };
}
