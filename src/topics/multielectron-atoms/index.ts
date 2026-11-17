import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const MultielectronAtomsSim = lazy(() => import("./sim").then((m) => ({ default: m.MultielectronAtomsSim })));

export const multielectronAtomsTopic: TopicModule = {
  meta: {
    slug: "multielectron-atoms",
    title: "Многоэлектронные атомы. Принцип Паули",
    sectionId: "quantum-physics",
    summary: "Принцип запрета Паули, заполнение оболочек, периодическая таблица",
  },
  Sim: MultielectronAtomsSim,
  notes,
  examples,
  problems,
  history,
};
