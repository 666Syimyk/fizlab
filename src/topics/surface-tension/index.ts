import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const SurfaceTensionSim = lazy(() => import("./sim").then((m) => ({ default: m.SurfaceTensionSim })));

export const surfaceTensionTopic: TopicModule = {
  meta: {
    slug: "surface-tension",
    title: "Поверхностное натяжение и капиллярные явления",
    sectionId: "thermodynamics",
    summary: "Коэффициент поверхностного натяжения, формула Лапласа, капилляры",
  },
  Sim: SurfaceTensionSim,
  notes,
  examples,
  problems,
  history,
};
