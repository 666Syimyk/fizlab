import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const NuclearReactionsFissionSim = lazy(() => import("./sim").then((m) => ({ default: m.NuclearReactionsFissionSim })));

export const nuclearReactionsFissionTopic: TopicModule = {
  meta: {
    slug: "nuclear-reactions-fission",
    title: "Ядерные реакции. Деление ядер",
    sectionId: "nuclear-physics",
    summary: "Законы сохранения в реакциях, деление урана, цепная реакция",
  },
  Sim: NuclearReactionsFissionSim,
  notes,
  examples,
  problems,
  history,
};
