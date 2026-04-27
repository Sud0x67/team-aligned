import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { installRendererErrorReporting } from "./error-reporting";
import "./styles.css";

installRendererErrorReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
