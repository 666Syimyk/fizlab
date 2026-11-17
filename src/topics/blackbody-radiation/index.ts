import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const BlackbodyRadiationSim = lazy(() => import("./sim").then((m) => ({ default: m.BlackbodyRadiationSim })));

export const blackbodyRadiationTopic: TopicModule = {
  meta: {
    slug: "blackbody-radiation",
    title: "Тепловое излучение",
    sectionId: "optics",
    summary: "Закон Стефана–Больцмана, закон Вина, формула Планка",
  },
  Sim: BlackbodyRadiationSim,
  notes,
  examples,
  problems,
  history,
};
