import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { restoreAppearance } from "./appearance.ts";
import { SpringrollApp } from "./springroll-app.tsx";
import "./design-system.css";
import "./styles.css";

await restoreAppearance();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Springroll could not find its page root");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <SpringrollApp />
    </BrowserRouter>
  </StrictMode>,
);
