import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const NucleusBindingEnergySim = lazy(() => import("./sim").then((m) => ({ default: m.NucleusBindingEnergySim })));

export const nucleusBindingEnergyTopic: TopicModule = {
  meta: {
    slug: "nucleus-binding-energy",
    title: "Строение ядра. Энергия связи",
    sectionId: "nuclear-physics",
    summary: "Состав ядра, дефект массы, энергия связи, удельная энергия связи",
  },
  Sim: NucleusBindingEnergySim,
  notes,
  examples,
  problems,
  history,
};
