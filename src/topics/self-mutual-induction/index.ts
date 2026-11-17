import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const SelfMutualInductionSim = lazy(() => import("./sim").then((m) => ({ default: m.SelfMutualInductionSim })));

export const selfMutualInductionTopic: TopicModule = {
  meta: {
    slug: "self-mutual-induction",
    title: "Самоиндукция и взаимоиндукция",
    sectionId: "electromagnetism",
    summary: "Индуктивность, ЭДС самоиндукции, энергия магнитного поля, трансформатор",
  },
  Sim: SelfMutualInductionSim,
  notes,
  examples,
  problems,
  history,
};
