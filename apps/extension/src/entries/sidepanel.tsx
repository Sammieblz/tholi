import { createRoot } from "react-dom/client";
import { GuidanceController } from "../ui/app/GuidanceController";
import { WidgetRegistration } from "../ui/app/WidgetRegistration";

const root = document.getElementById("root")!;
createRoot(root).render(
  location.pathname.endsWith("/widget.html") ? (
    <WidgetRegistration>
      <GuidanceController widget />
    </WidgetRegistration>
  ) : (
    <GuidanceController />
  ),
);
