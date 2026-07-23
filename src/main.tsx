import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installViewportFit } from "./lib/viewportFit";

// Lock height to real visible screen before first paint
installViewportFit();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
