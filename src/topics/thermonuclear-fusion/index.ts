import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ThermonuclearFusionSim = lazy(() => import("./sim").then((m) => ({ default: m.ThermonuclearFusionSim })));

export const thermonuclearFusionTopic: TopicModule = {
  meta: {
    slug: "thermonuclear-fusion",
    title: "Термоядерный синтез. Энергия звёзд",
    sectionId: "nuclear-physics",
    summary: "Протон-протонный цикл, синтез дейтерия и трития, энергетика будущего",
  },
  Sim: ThermonuclearFusionSim,
  notes,
  examples,
  problems,
  history,
};
