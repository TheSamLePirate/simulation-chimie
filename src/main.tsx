import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Élément racine #root introuvable");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
