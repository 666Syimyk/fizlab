import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const LorentzForceSim = lazy(() => import("./sim").then((m) => ({ default: m.LorentzForceSim })));

export const lorentzForceTopic: TopicModule = {
  meta: {
    slug: "lorentz-force",
    title: "Сила Лоренца",
    sectionId: "electromagnetism",
    summary: "Сила Лоренца, движение заряда в магнитном поле, циклотрон",
  },
  Sim: LorentzForceSim,
  notes,
  examples,
  problems,
  history,
};
