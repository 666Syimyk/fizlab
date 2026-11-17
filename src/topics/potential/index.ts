import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const PotentialSim = lazy(() => import("./sim").then((m) => ({ default: m.PotentialSim })));

export const potentialTopic: TopicModule = {
  meta: {
    slug: "potential",
    title: "Потенциал. Работа поля",
    sectionId: "electromagnetism",
    summary: "Потенциал, разность потенциалов, эквипотенциальные поверхности",
  },
  Sim: PotentialSim,
  notes,
  examples,
  problems,
  history,
};
