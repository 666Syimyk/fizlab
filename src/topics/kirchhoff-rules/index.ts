import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const KirchhoffRulesSim = lazy(() => import("./sim").then((m) => ({ default: m.KirchhoffRulesSim })));

export const kirchhoffRulesTopic: TopicModule = {
  meta: {
    slug: "kirchhoff-rules",
    title: "Правила Кирхгофа",
    sectionId: "electromagnetism",
    summary: "Правило узлов и правило контуров для расчёта разветвлённых цепей",
  },
  Sim: KirchhoffRulesSim,
  notes,
  examples,
  problems,
  history,
};
