import { createRoot } from "react-dom/client";
import { GuidanceController } from "../ui/app/GuidanceController";

const root = document.getElementById("root")!;
if (location.pathname.endsWith("/widget.html")) {
  void chrome.runtime.sendMessage({ type: "UI_REGISTER" }).then((result) => {
    if (result.error) {
      root.textContent =
        "Reconnecting to this website. Open Tholi from the toolbar if access is needed.";
      return;
    }
    createRoot(root).render(<GuidanceController widget />);
  });
} else createRoot(root).render(<GuidanceController />);
