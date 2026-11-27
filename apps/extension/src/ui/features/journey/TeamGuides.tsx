import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { publishedGuideListSchema } from "../../../../../../packages/navigation-core/contracts-organization";
import { accountRpc } from "../account/account-client";
import { serviceAuthStatusSchema } from "../../../platform/service-auth-contract";

export function TeamGuides({
  sessionId,
  documentId,
  origin,
}: {
  sessionId: string;
  documentId: string;
  origin: string;
}) {
  const version = useRef(0);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [teams, setTeams] = useState<string[]>([]);
  const [team, setTeam] = useState("");
  const [guides, setGuides] = useState<
    z.infer<typeof publishedGuideListSchema>["items"]
  >([]);
  const [step, setStep] = useState<{
    id: string;
    index: number;
    count: number;
  }>();
  const [notice, setNotice] = useState("");
  function clear() {
    version.current++;
    setBusy(false);
    setAccount("");
    setTeams([]);
    setTeam("");
    setGuides([]);
    setStep(undefined);
    setNotice("");
  }
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("offline", clear);
    window.addEventListener("tholi-account-change", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      version.current++;
      window.removeEventListener("offline", clear);
      window.removeEventListener("tholi-account-change", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const request = (accountId: string, extra: object = {}) =>
    accountRpc({
      type: "TEAM_GUIDE",
      sessionId,
      documentId,
      accountId,
      ...extra,
    });
  async function run(load: () => Promise<() => void>) {
    const expected = ++version.current;
    setBusy(true);
    setNotice("");
    try {
      const render = await load();
      if (version.current === expected) render();
    } catch {
      if (version.current === expected) {
        clear();
        setNotice(
          "Team guides are unavailable. Check your sign-in, team membership and website access.",
        );
      }
    } finally {
      if (version.current === expected) setBusy(false);
    }
  }
  function open() {
    clear();
    void run(async () => {
      const status = serviceAuthStatusSchema.parse(
        await accountRpc({ type: "AUTH_STATUS" }),
      );
      if (!status.account)
        return () =>
          setNotice(
            "Sign in through Account settings to open your team's guides.",
          );
      const id = status.account.id;
      const { workspaces } = z
        .object({ workspaces: z.array(z.string().uuid()).max(100) })
        .parse(await request(id));
      return () => {
        setAccount(id);
        setTeams(workspaces);
        if (!workspaces.length) setNotice("You have no team workspaces.");
      };
    });
  }
  function selectTeam(workspaceId: string) {
    version.current++;
    setTeam(workspaceId);
    setGuides([]);
    setStep(undefined);
    setNotice("");
    if (!workspaceId) return;
    void run(async () => {
      const list = publishedGuideListSchema.parse(
        await request(account, { workspaceId }),
      );
      return () => {
        setGuides(list.items);
        if (!list.items.length)
          setNotice("Your team has no published guides for this website.");
      };
    });
  }
  function readStep(id: string, index: number) {
    const guide = guides.find((item) => item.id === id);
    if (!guide) return;
    void run(async () => {
      const result = z
        .object({
          instruction: z.string().max(500),
          count: z.number().int().min(1).max(64),
          highlighted: z.boolean(),
        })
        .parse(
          await request(account, {
            workspaceId: team,
            selection: { id, revision: guide.revision, index },
          }),
        );
      return () => {
        setStep({ id, index, count: result.count });
        setNotice(
          result.instruction +
            (result.highlighted
              ? " The matching control is highlighted."
              : " Review this step on the website."),
        );
      };
    });
  }
  return (
    <details
      onToggle={(event) => {
        if (!event.currentTarget.open) clear();
      }}
    >
      <summary>Team guides</summary>
      <p>
        Choose a team to share this website's origin ({origin}) with your Tholi
        service. Each step checks the current publication.
      </p>
      <button type="button" disabled={busy} onClick={open}>
        Find my teams
      </button>
      {teams.length > 0 && (
        <label>
          Team workspace
          <select
            value={team}
            disabled={busy}
            onChange={(event) => selectTeam(event.target.value)}
          >
            <option value="">Choose a team</option>
            {teams.map((id) => (
              <option value={id} key={id}>
                {id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {guides.map((guide) => (
        <button
          type="button"
          key={guide.id}
          disabled={busy}
          onClick={() => readStep(guide.id, 0)}
        >
          {guide.title}
        </button>
      ))}
      <p role="status">{busy ? "Checking team access." : notice}</p>
      {step && (
        <div>
          <p>
            Instruction {step.index + 1} of {step.count}
          </p>
          <button
            type="button"
            disabled={busy || step.index === 0}
            onClick={() => readStep(step.id, step.index - 1)}
          >
            Previous instruction
          </button>
          <button
            type="button"
            disabled={busy || step.index + 1 >= step.count}
            onClick={() => readStep(step.id, step.index + 1)}
          >
            Next instruction
          </button>
        </div>
      )}
    </details>
  );
}
