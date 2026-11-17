import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ComptonEffectSim = lazy(() => import("./sim").then((m) => ({ default: m.ComptonEffectSim })));

export const comptonEffectTopic: TopicModule = {
  meta: {
    slug: "compton-effect",
    title: "Эффект Комптона. Давление света",
    sectionId: "quantum-physics",
    summary: "Импульс фотона, формула Комптона, давление света",
  },
  Sim: ComptonEffectSim,
  notes,
  examples,
  problems,
  history,
};
