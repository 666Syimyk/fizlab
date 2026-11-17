import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const RadioactivitySim = lazy(() => import("./sim").then((m) => ({ default: m.RadioactivitySim })));

export const radioactivityTopic: TopicModule = {
  meta: {
    slug: "radioactivity",
    title: "Радиоактивность",
    sectionId: "nuclear-physics",
    summary: "Виды распада, закон радиоактивного распада, период полураспада",
  },
  Sim: RadioactivitySim,
  notes,
  examples,
  problems,
  history,
};
