import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@xyflow/react/dist/base.css";
import "./styles.css";
import { App } from "./app/App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
