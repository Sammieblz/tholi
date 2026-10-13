import { fixture } from "../nlp/fixtures";
import type { PageControl, PageSnapshot } from "../../packages/page-model";
export function appFixture(
  platform: string,
  origin: string,
  ambiguous = false,
): PageSnapshot {
  const p = fixture(),
    labels: Record<string, string[]> = {
      cloudflare: ["Workers & Pages", "Help", "Search"],
      github: ["Settings", "Search repositories", "Help"],
      jira: ["Projects", "Help", "Search issues"],
      youtube: ["Settings", "Help", "Search"],
      netflix: ["Account", "Help", "Search Netflix"],
      amazon: ["Prime", "Help", "Search Amazon"],
    };
  const controls: PageControl[] = labels[platform].map((label, i) => ({
    ...p.controls[0],
    id: `w0000000000000000-${i}`,
    signature: platform + "-" + i,
    label,
    kind: /^Search/.test(label)
      ? "focus"
      : label === "Settings" && platform === "youtube"
        ? "expand"
        : "navigation",
    context: platform === "github" && label === "Settings" ? "Repository" : "",
    group: "Navigation",
    destination: undefined,
  }));
  if (ambiguous && platform !== "cloudflare") {
    const label =
      platform === "jira"
        ? "Project settings"
        : ["netflix", "amazon"].includes(platform)
          ? "Account"
          : "Settings";
    controls.length = 0;
    for (let i = 0; i < 2; i++)
      controls.push({
        ...p.controls[0],
        id: `w0000000000000000-${i}`,
        signature: "ambiguous-" + i,
        label,
        context: i === 0 ? "Workspace" : "Profile",
        kind: "navigation",
        destination: undefined,
      });
  }
  if (platform === "youtube" && !ambiguous)
    controls[0].context = "Video player";
  return { ...p, origin, controls, signals: [], busy: false };
}
