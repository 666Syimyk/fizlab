import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const HeatEnginesCarnotSim = lazy(() => import("./sim").then((m) => ({ default: m.HeatEnginesCarnotSim })));

export const heatEnginesCarnotTopic: TopicModule = {
  meta: {
    slug: "heat-engines-carnot",
    title: "Тепловые машины. Цикл Карно",
    sectionId: "thermodynamics",
    summary: "КПД тепловой машины, обратимый цикл Карно, предельный КПД",
  },
  Sim: HeatEnginesCarnotSim,
  notes,
  examples,
  problems,
  history,
};
