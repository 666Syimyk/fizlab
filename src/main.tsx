import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { LenisProvider } from "@/components/LenisProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { SubscriptionProvider } from "@/components/SubscriptionProvider";
import { AccountAccessProvider } from "@/components/AccountAccessProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
    <AuthProvider>
    <SubscriptionProvider>
    <AccountAccessProvider>
      <LenisProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LenisProvider>
    </AccountAccessProvider>
    </SubscriptionProvider>
    </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
