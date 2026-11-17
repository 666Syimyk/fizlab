import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ElectromagneticInductionSim = lazy(() => import("./sim").then((m) => ({ default: m.ElectromagneticInductionSim })));

export const electromagneticInductionTopic: TopicModule = {
  meta: {
    slug: "electromagnetic-induction",
    title: "Электромагнитная индукция. Закон Фарадея",
    sectionId: "electromagnetism",
    summary: "Магнитный поток, закон Фарадея, правило Ленца, вихревые токи",
  },
  Sim: ElectromagneticInductionSim,
  notes,
  examples,
  problems,
  history,
};
