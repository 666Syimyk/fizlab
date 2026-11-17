import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const DosimetryProtectionSim = lazy(() => import("./sim").then((m) => ({ default: m.DosimetryProtectionSim })));

export const dosimetryProtectionTopic: TopicModule = {
  meta: {
    slug: "dosimetry-protection",
    title: "Дозиметрия и защита от излучения",
    sectionId: "nuclear-physics",
    summary: "Поглощённая и эквивалентная дозы, принципы защиты от излучения",
  },
  Sim: DosimetryProtectionSim,
  notes,
  examples,
  problems,
  history,
};
