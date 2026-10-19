import { api } from "../../platform/api";
import { useEffect, useState } from "react";

export function useBackendSettings(widget: boolean) {
  const [visionBackend, setVisionBackend] = useState(false);
  const [backend, setBackend] = useState({
    url: "http://127.0.0.1:8787",
    token: "",
    enabled: false,
  });
  useEffect(() => {
    if (widget) return;
    void api.runtime
      .sendMessage({ type: "GET_VISION" })
      .then((r) => setVisionBackend(!!r.backend))
      .catch(() => {});
    void api.runtime
      .sendMessage({ type: "GET_BACKEND" })
      .then((r) => {
        if (!r.error) setBackend(r);
      })
      .catch(() => {});
  }, []);
  return { visionBackend, setVisionBackend, backend, setBackend };
}
