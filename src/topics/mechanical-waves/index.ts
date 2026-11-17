import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const MechanicalWavesSim = lazy(() => import("./sim").then((m) => ({ default: m.MechanicalWavesSim })));

export const mechanicalWavesTopic: TopicModule = {
  meta: {
    slug: "mechanical-waves",
    title: "Механические волны",
    sectionId: "mechanics",
    summary: "Уравнение волны, стоячие волны, звук и эффект Доплера",
  },
  Sim: MechanicalWavesSim,
  notes,
  examples,
  problems,
  history,
};
