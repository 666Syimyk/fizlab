import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const EntropySecondLawSim = lazy(() => import("./sim").then((m) => ({ default: m.EntropySecondLawSim })));

export const entropySecondLawTopic: TopicModule = {
  meta: {
    slug: "entropy-second-law",
    title: "Второе начало термодинамики. Энтропия",
    sectionId: "thermodynamics",
    summary: "Формулировки второго начала, энтропия и её статистический смысл",
  },
  Sim: EntropySecondLawSim,
  notes,
  examples,
  problems,
  history,
};
