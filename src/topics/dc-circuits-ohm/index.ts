import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const DcCircuitsOhmSim = lazy(() => import("./sim").then((m) => ({ default: m.DcCircuitsOhmSim })));

export const dcCircuitsOhmTopic: TopicModule = {
  meta: {
    slug: "dc-circuits-ohm",
    title: "Постоянный ток: закон Ома, ЭДС",
    sectionId: "electromagnetism",
    summary: "Закон Ома для участка и полной цепи, ЭДС, соединения резисторов",
  },
  Sim: DcCircuitsOhmSim,
  notes,
  examples,
  problems,
  history,
};
