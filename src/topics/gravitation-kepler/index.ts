import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const GravitationKeplerSim = lazy(() => import("./sim").then((m) => ({ default: m.GravitationKeplerSim })));

export const gravitationKeplerTopic: TopicModule = {
  meta: {
    slug: "gravitation-kepler",
    title: "Гравитация: закон тяготения, законы Кеплера",
    sectionId: "mechanics",
    summary: "Закон всемирного тяготения, законы Кеплера, космические скорости",
  },
  Sim: GravitationKeplerSim,
  notes,
  examples,
  problems,
  history,
};
