// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import ValorizationReportApp from "./ValorizationReportApp";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ValorizationReportApp />
  </React.StrictMode>
);
