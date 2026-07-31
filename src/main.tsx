import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { installGpuHarness } from "./dev/gpuHarness";
import { loadWebfonts } from "./ui/brand/webfonts";
import "./app/styles.css";

installGpuHarness();
loadWebfonts();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Élément racine #root introuvable");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
