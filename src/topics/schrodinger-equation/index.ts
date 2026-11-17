import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const SchrodingerEquationSim = lazy(() => import("./sim").then((m) => ({ default: m.SchrodingerEquationSim })));

export const schrodingerEquationTopic: TopicModule = {
  meta: {
    slug: "schrodinger-equation",
    title: "Уравнение Шрёдингера",
    sectionId: "quantum-physics",
    summary: "Волновая функция, частица в потенциальной яме, туннельный эффект",
  },
  Sim: SchrodingerEquationSim,
  notes,
  examples,
  problems,
  history,
};
