import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./App";

// Note: React Flow v12's node measurement breaks under StrictMode's double-mount
// (nodes never get `measured`, so edges can't compute their paths and don't
// render). Rendering without StrictMode is the documented workaround.
createRoot(document.getElementById("root")!).render(<App />);
