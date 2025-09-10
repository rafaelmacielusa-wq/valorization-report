import React from "react";
import { createRoot } from "react-dom/client";
import App from "./index"; // seu componente default do canvas

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
