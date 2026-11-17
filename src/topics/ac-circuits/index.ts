import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const AcCircuitsSim = lazy(() => import("./sim").then((m) => ({ default: m.AcCircuitsSim })));

export const acCircuitsTopic: TopicModule = {
  meta: {
    slug: "ac-circuits",
    title: "Переменный ток: RLC-цепи, резонанс",
    sectionId: "electromagnetism",
    summary: "Реактивные сопротивления, импеданс, резонанс, мощность переменного тока",
  },
  Sim: AcCircuitsSim,
  notes,
  examples,
  problems,
  history,
};
