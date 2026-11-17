import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const RealGasesVdwSim = lazy(() => import("./sim").then((m) => ({ default: m.RealGasesVdwSim })));

export const realGasesVdwTopic: TopicModule = {
  meta: {
    slug: "real-gases-vdw",
    title: "Реальные газы. Уравнение Ван-дер-Ваальса",
    sectionId: "thermodynamics",
    summary: "Поправки на объём молекул и притяжение, критическая точка",
  },
  Sim: RealGasesVdwSim,
  notes,
  examples,
  problems,
  history,
};
