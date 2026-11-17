import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const UncertaintyPrincipleSim = lazy(() => import("./sim").then((m) => ({ default: m.UncertaintyPrincipleSim })));

export const uncertaintyPrincipleTopic: TopicModule = {
  meta: {
    slug: "uncertainty-principle",
    title: "Соотношение неопределённостей Гейзенберга",
    sectionId: "quantum-physics",
    summary: "Δx·Δp ≥ ħ/2, фундаментальная природа неопределённости",
  },
  Sim: UncertaintyPrincipleSim,
  notes,
  examples,
  problems,
  history,
};
