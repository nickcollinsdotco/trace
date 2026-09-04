import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./design/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("TRACE: #root missing from index.html");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
