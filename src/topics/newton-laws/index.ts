import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const NewtonLawsSim = lazy(() => import("./sim").then((m) => ({ default: m.NewtonLawsSim })));

export const newtonLawsTopic: TopicModule = {
  meta: {
    slug: "newton-laws",
    title: "Законы Ньютона",
    sectionId: "mechanics",
    summary: "Инерция, основное уравнение динамики, действие и противодействие",
  },
  Sim: NewtonLawsSim,
  notes,
  examples,
  problems,
  history,
};
