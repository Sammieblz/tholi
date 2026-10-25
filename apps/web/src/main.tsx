import "../../../packages/ui/tokens.css";
import "./styles/site.css";
import "./styles/motion.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Router } from "./app/router";
import { PreferencesProvider } from "./features/preferences";

createRoot(document.getElementById("root")!).render(
  <PreferencesProvider>
    <Router manageTitle={false}>
      <App />
    </Router>
  </PreferencesProvider>,
);
