import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const CapacitorsSim = lazy(() => import("./sim").then((m) => ({ default: m.CapacitorsSim })));

export const capacitorsTopic: TopicModule = {
  meta: {
    slug: "capacitors",
    title: "Конденсаторы. Энергия электрического поля",
    sectionId: "electromagnetism",
    summary: "Электроёмкость, плоский конденсатор, соединения, энергия поля",
  },
  Sim: CapacitorsSim,
  notes,
  examples,
  problems,
  history,
};
