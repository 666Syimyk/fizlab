import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.fizlab.course",
  appName: "ФизЛаб 3D",
  webDir: "dist/client",
  server: { androidScheme: "https" },
};

export default config;
