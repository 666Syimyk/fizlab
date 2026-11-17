import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const FluidMechanicsSim = lazy(() => import("./sim").then((m) => ({ default: m.FluidMechanicsSim })));

export const fluidMechanicsTopic: TopicModule = {
  meta: {
    slug: "fluid-mechanics",
    title: "Механика жидкостей",
    sectionId: "mechanics",
    summary: "Гидростатическое давление, закон Архимеда, уравнение Бернулли",
  },
  Sim: FluidMechanicsSim,
  notes,
  examples,
  problems,
  history,
};
