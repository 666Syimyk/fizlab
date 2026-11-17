import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const MagneticMaterialsSim = lazy(() => import("./sim").then((m) => ({ default: m.MagneticMaterialsSim })));

export const magneticMaterialsTopic: TopicModule = {
  meta: {
    slug: "magnetic-materials",
    title: "Магнитные свойства вещества",
    sectionId: "electromagnetism",
    summary: "Диа-, пара- и ферромагнетики, домены, точка Кюри",
  },
  Sim: MagneticMaterialsSim,
  notes,
  examples,
  problems,
  history,
};
