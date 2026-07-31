import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ShrimpRollApp } from "./shrimproll-app.tsx";
import { loadTextSizePreference, loadThemePreference } from "./themes.ts";
import "./design-system.css";
import "./styles.css";

loadThemePreference();
loadTextSizePreference();

const root = document.getElementById("root");
if (!root) {
  throw new Error("ShrimpRoll could not find its page root");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ShrimpRollApp />
    </BrowserRouter>
  </StrictMode>,
);
