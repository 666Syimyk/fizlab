import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const DampedForcedOscillationsSim = lazy(() => import("./sim").then((m) => ({ default: m.DampedForcedOscillationsSim })));

export const dampedForcedOscillationsTopic: TopicModule = {
  meta: {
    slug: "damped-forced-oscillations",
    title: "Затухающие и вынужденные колебания. Резонанс",
    sectionId: "mechanics",
    summary: "Затухание, вынуждающая сила, резонансная частота и добротность",
  },
  Sim: DampedForcedOscillationsSim,
  notes,
  examples,
  problems,
  history,
};
