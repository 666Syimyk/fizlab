import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const FirstLawThermoSim = lazy(() => import("./sim").then((m) => ({ default: m.FirstLawThermoSim })));

export const firstLawThermoTopic: TopicModule = {
  meta: {
    slug: "first-law-thermo",
    title: "Первое начало термодинамики",
    sectionId: "thermodynamics",
    summary: "Внутренняя энергия, теплота, работа газа, теплоёмкости Cv и Cp",
  },
  Sim: FirstLawThermoSim,
  notes,
  examples,
  problems,
  history,
};
