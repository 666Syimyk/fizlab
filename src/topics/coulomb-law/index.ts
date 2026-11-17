import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const CoulombLawSim = lazy(() => import("./sim").then((m) => ({ default: m.CoulombLawSim })));

export const coulombLawTopic: TopicModule = {
  meta: {
    slug: "coulomb-law",
    title: "Закон Кулона. Напряжённость поля",
    sectionId: "electromagnetism",
    summary: "Сила взаимодействия зарядов, напряжённость поля, принцип суперпозиции",
  },
  Sim: CoulombLawSim,
  notes,
  examples,
  problems,
  history,
};
