import { useEffect } from "react";

/** Keep client navigation consistent with the build-time HTML metadata. */
export function usePageMetadata(path: string) {
  useEffect(() => {
    let canceled = false;
    void import("./metadata").then(({ metadataForPath, seoTags }) => {
      if (canceled) return;
      const template = document.createElement("template");
      template.innerHTML = seoTags(metadataForPath(path));
      document.head
        .querySelectorAll("[data-tholi-seo]")
        .forEach((element) => element.remove());
      document.head.append(template.content);
    });
    return () => {
      canceled = true;
    };
  }, [path]);
}
