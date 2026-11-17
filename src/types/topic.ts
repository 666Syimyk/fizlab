import type { ComponentType } from "react";

export interface NoteBlock {
  type: "heading" | "paragraph" | "formula" | "list";
  content: string | string[];
}

export interface Example {
  title: string;
  problem: string;
  /** "Дано" lines, e.g. ["m = 2 кг", "v_0 = 5 м/с"] */
  given?: string[];
  /** "Найти" line, e.g. "t — ?" */
  find?: string;
  solution: string[];
  answer?: string;
  /** short "на что обратить внимание" remark */
  note?: string;
}

export interface Problem {
  id: string;
  question: string;
  answer: number;
  unit?: string;
  tolerancePercent: number;
  hints: string[];
  solution: string[];
  /** short remark on which laws/formulas the problem combines, shown with the solution */
  note?: string;
}

export interface HistoryFact {
  year?: string;
  title: string;
  text: string;
}

export interface HistoryContent {
  discoverer: string;
  year: string;
  rival?: string;
  rivalText?: string;
  facts: HistoryFact[];
  /** slugs referencing entries in the central scientists registry (src/data/scientists.ts) */
  scientists?: string[];
}

export interface Scientist {
  name: string;
  years: string;
  achievement: string;
  /** filename inside public/physicists/ */
  photo: string;
  sourceUrl: string;
  license: string;
  author?: string;
}

export interface TopicMeta {
  slug: string;
  title: string;
  sectionId: string;
  summary: string;
  /** true when this topic has no real content yet (auto-generated placeholder) */
  stub?: boolean;
}

export interface TopicModule {
  meta: TopicMeta;
  notes: NoteBlock[];
  history: HistoryContent;
  Sim?: ComponentType;
  examples?: Example[];
  problems?: Problem[];
}
