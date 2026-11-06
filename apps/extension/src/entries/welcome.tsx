import { createRoot } from "react-dom/client";
import { WelcomeSetup } from "../ui/features/account/WelcomeSetup";
import "../../../../packages/ui/styles/tokens.css";
import "../../../../packages/ui/styles/editorial.css";

createRoot(document.getElementById("root")!).render(<WelcomeSetup />);
