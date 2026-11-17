import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const WorkPowerEnergySim = lazy(() => import("./sim").then((m) => ({ default: m.WorkPowerEnergySim })));

export const workPowerEnergyTopic: TopicModule = {
  meta: {
    slug: "work-power-energy",
    title: "Работа, мощность, энергия. Закон сохранения энергии",
    sectionId: "mechanics",
    summary: "Работа и мощность силы, кинетическая и потенциальная энергия, сохранение энергии",
  },
  Sim: WorkPowerEnergySim,
  notes,
  examples,
  problems,
  history,
};
