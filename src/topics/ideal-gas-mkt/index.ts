import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const IdealGasMktSim = lazy(() => import("./sim").then((m) => ({ default: m.IdealGasMktSim })));

export const idealGasMktTopic: TopicModule = {
  meta: {
    slug: "ideal-gas-mkt",
    title: "Основы МКТ. Идеальный газ",
    sectionId: "thermodynamics",
    summary: "Основное уравнение МКТ, температура, уравнение Менделеева–Клапейрона",
  },
  Sim: IdealGasMktSim,
  notes,
  examples,
  problems,
  history,
};
