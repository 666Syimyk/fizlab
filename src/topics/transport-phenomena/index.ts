import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const TransportPhenomenaSim = lazy(() => import("./sim").then((m) => ({ default: m.TransportPhenomenaSim })));

export const transportPhenomenaTopic: TopicModule = {
  meta: {
    slug: "transport-phenomena",
    title: "Явления переноса",
    sectionId: "thermodynamics",
    summary: "Диффузия, теплопроводность и вязкость: законы Фика, Фурье, Ньютона",
  },
  Sim: TransportPhenomenaSim,
  notes,
  examples,
  problems,
  history,
};
