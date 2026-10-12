import { test, expect } from "vitest";
import { interpretRequest, canonicalGoal } from "../packages/nlp/interpret";
import {
  advanceQueue,
  pauseQueue,
  stopQueue,
  resumeQueue,
  matchesStamp,
} from "../packages/navigation-core/queue";
import { sanitizeGoal, sanitizeText } from "../packages/privacy-redaction";
test("question framing preserves the target and requested reading operation", () => {
  expect(
    interpretRequest("Where can I read the privacy policy?").tasks[0],
  ).toMatchObject({ target: "privacy policy", operation: "navigate" });
  expect(interpretRequest("Where are the references?").tasks[0]).toMatchObject({
    target: "references",
    operation: "locate",
  });
  expect(
    interpretRequest("Where can we find our invoices?").tasks[0].target,
  ).toBe("our invoices");
});
test("full requests preserve values, exclusions, corrections, and ordered compatible references", () => {
  const request = interpretRequest(
    "Please open languages and then change it to Spanish, but not French.",
  );
  expect(request.tasks).toHaveLength(2);
  expect(request.tasks[1].target).toBe("languages");
  expect(request.tasks[1].desiredValue).toBe("Spanish");
  expect(request.tasks[1].exclusions).toEqual(["French"]);
  expect(
    interpretRequest("Please turn notifications off").tasks[0],
  ).toMatchObject({ target: "notifications", desiredValue: "off" });
  expect(interpretRequest("Enable notifications").tasks[0]).toMatchObject({
    target: "notifications",
    desiredValue: "on",
  });
  expect(interpretRequest("Don't log in").tasks[0].negatedOnly).toBe(true);
  expect(interpretRequest("Don't log in").tasks[0].exclusions).toEqual([
    "log in",
  ]);
  expect(canonicalGoal(request.tasks[1])).toBe("Change languages to Spanish");
  expect(
    interpretRequest("Open languages, actually open appearance").tasks[0]
      .target,
  ).toBe("appearance");
  expect(interpretRequest("Change it to Spanish").tasks[0].needsReference).toBe(
    true,
  );
});
test("1000-character goal validation does not expand control text limits or silently truncate exclusions", () => {
  const request = "Find " + "readable ".repeat(70) + "references but not tools";
  expect(sanitizeGoal(request)).toContain("but not tools");
  expect(sanitizeGoal(request).length).toBeGreaterThan(160);
  expect(sanitizeText(request)).toHaveLength(160);
  expect(() => sanitizeGoal("a".repeat(1001))).toThrow("1,000");
});
test("three-task limit, pause, Stop, blocked review and Skip never record false success", () => {
  const request = interpretRequest(
    "Open languages then open appearance then open tools",
  );
  expect(request.tasks).toHaveLength(3);
  expect(() =>
    interpretRequest(
      "Open languages then open appearance then open tools then open settings",
    ),
  ).toThrow("three");
  expect(advanceQueue(request, "wrong").active).toBe(0);
  expect(advanceQueue(pauseQueue(request), "verified").active).toBe(0);
  expect(advanceQueue(stopQueue(request), "verified").active).toBe(0);
  const blocked = advanceQueue(request, "boundary");
  expect(blocked.status).toBe("blocked");
  expect(advanceQueue(blocked, "verified").active).toBe(0);
  expect(resumeQueue(pauseQueue(blocked)).status).toBe("blocked");
  const skip = advanceQueue(blocked, "skipped");
  expect(skip.active).toBe(1);
  expect(skip.tasks[0].status).toBe("skipped");
  expect(skip.tasks[1].status).toBe("active");
  const next = advanceQueue(request, "verified");
  expect(next.active).toBe(1);
  expect(next.tasks[0].status).toBe("completed");
});
test("document, request and scan stamps all participate in asynchronous result validation", () => {
  const stamp = { requestId: "request", documentId: "doc", revision: 1 };
  expect(matchesStamp(stamp, stamp)).toBe(true);
  for (const altered of [
    { ...stamp, requestId: "old" },
    { ...stamp, documentId: "old" },
    { ...stamp, revision: 0 },
  ])
    expect(matchesStamp(altered, stamp)).toBe(false);
});
