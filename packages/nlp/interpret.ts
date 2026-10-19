import nlp from "compromise";
import type {
  NavigationRequest,
  TaskIntent,
} from "../navigation-core/contracts";
import { sanitizeGoal } from "../privacy-redaction";
import {
  normalizeIntentText,
  authenticationIntent,
} from "../goal-planner/task-intent";
const clean = (s: string) =>
  s
    .trim()
    .replace(/^["'“”]+|["'“”.!?,;:]+$/g, "")
    .trim();
const actions =
  "(?:open|show|find|navigate|go|change|switch|set|select|choose|turn|search|look|edit|create|log|sign|make|hide|enable|disable|read|view|deploy|publish|host|launch|cancel|unsubscribe|upgrade|downgrade|configure|report|add|sort|filter|order)";
export function interpretRequest(
  text: string,
  context?: { target?: string },
  options?: { clauses?: boolean },
): NavigationRequest {
  const original = sanitizeGoal(text);
  if (!original) throw new Error("Describe what you would like to do.");
  const doc = nlp(normalizeIntentText(original));
  // Compromise identifies sentence boundaries and normalizes contractions/POS. Split
  // only explicit conjunctions followed by an action, preserving noun conjunctions.
  doc.contractions().expand();
  let sentence = doc.text();
  sentence = sentence.replace(
    /\b(?:no|actually|rather|instead),?\s+(?:I\s+(?:mean|want)\s+)?/gi,
    " CORRECTION ",
  );
  if (sentence.includes("CORRECTION"))
    sentence = sentence.split("CORRECTION").at(-1)!;
  const clauses = sentence
    .split(
      new RegExp(
        `(?:[.;]\\s*|\\b(?:and then|then|after that|and)\\s+)(?=(?:please\\s+)?${actions}\\b)`,
        "i",
      ),
    )
    .map((s) =>
      options?.clauses
        ? s
            .trim()
            .replace(/[.!?,;:]+$/, "")
            .trim()
        : clean(s),
    )
    .filter(Boolean);
  if (clauses.length > 3)
    throw new Error("Please split this request into at most three tasks.");
  let reference = context?.target;
  const tasks = clauses.map((clause) => {
    const task = interpretClause(clause, reference);
    if (options?.clauses) task.clause = clause;
    if (!task.needsReference) reference = task.target;
    return task;
  });
  if (tasks.length === 1) tasks[0].original = original;
  tasks[0].status = "active";
  return {
    id: crypto.randomUUID(),
    original,
    tasks,
    active: 0,
    status: "active",
    createdAt: Date.now(),
  };
}
function interpretClause(original: string, reference?: string): TaskIntent {
  const doc = nlp(original);
  let text = doc.text();
  const exclusions: string[] = [];
  text = text.replace(
    /\b(?:but\s+)?(?:do not|don't|not|without|except|excluding|avoid)\s+(.+?)(?=,|\bbut\b|$)/gi,
    (_m, value) => {
      exclusions.push(
        clean(value).replace(
          /^(?:open|show|find|navigate|go|choose|select|use|click)\s+(?:the\s+)?/i,
          "",
        ),
      );
      return "";
    },
  );
  text = clean(text)
    .replace(
      /^(?:(?:hi|hello)[,!]?\s*)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:(?:help|guide|show|tell)\s+me\s+(?:how\s+)?(?:to\s+)?)?(?:(?:I|we)\s+(?:would\s+like|want|need|am\s+trying)\s+to\s+)?(?:(?:how|where)\s+(?:do|can|could|would|will)\s+(?:I|we)\s+)?(?:where\s+(?:is|are)\s+)?/i,
      "",
    )
    .replace(/\s+(?:please|for me|on this (?:page|website|site))$/i, "");
  let operation: TaskIntent["operation"] = "locate";
  let desiredValue: string | undefined;
  let target = text;
  const search = text.match(/^(?:search|look)\s+(?:for\s+)?(.+)$/i);
  const change = text.match(
    /^(?:change|switch|set|choose|select|turn|make)\s+(?:the\s+)?(.+?)\s+(?:to|into)\s+(.+)$/i,
  );
  const prefixState = text.match(
    /^(?:turn|switch)\s+(on|off)\s+(?:the\s+)?(.+)$/i,
  );
  const suffixState = text.match(
    /^(?:turn|switch|set)\s+(?:the\s+)?(.+?)\s+(on|off)$/i,
  );
  const enableState = text.match(/^(enable|disable)\s+(?:the\s+)?(.+)$/i);
  const sorting =
    text.match(/^(?:sort|order)\s+(?:.*?)\bby\s+(.+)$/i) ||
    text.match(/^(?:sort|order)\s+(.+)$/i);
  const filtering =
    text.match(/^filter\b.*?\b(?:by|to|for)\s+(.+)$/i) ||
    text.match(
      /^(?:show|find)\s+only\s+(.+?)(?:\s+(?:products|results|items))?$/i,
    );
  if (sorting) {
    operation = "choose";
    target = "Sort by";
    desiredValue = clean(sorting[1]);
    if (/cheapest|lowest price|price (?:low|ascending)/i.test(desiredValue))
      desiredValue = "Price low to high";
    if (
      /most expensive|highest price|price (?:high|descending)/i.test(
        desiredValue,
      )
    )
      desiredValue = "Price high to low";
  } else if (filtering) {
    operation = "choose";
    target = clean(filtering[1]);
    desiredValue = "on";
  } else if (prefixState || suffixState || enableState) {
    operation = "choose";
    target = clean(prefixState?.[2] || suffixState?.[1] || enableState![2]);
    desiredValue = (
      prefixState?.[1] ||
      suffixState?.[2] ||
      (enableState![1].toLowerCase() === "enable" ? "on" : "off")
    ).toLowerCase();
  } else if (search && !/^(?:field|box|button|control)$/i.test(search[1])) {
    operation = "search";
    target = "Search";
    desiredValue = clean(search[1]);
  } else if (change) {
    operation = "choose";
    target = clean(change[1]);
    desiredValue = clean(change[2]);
    const scoped =
      !/^["'“‘`]/.test(change[2].trim()) &&
      desiredValue.match(
        /^(.*?)\s+(?:in|for|on)\s+(?:(?:(?:the|my)\s+)?(?:repository|repo|project|space|account)\s+.+|(?:that|this|same)\s+(?:repository|repo|project|space|workspace|account|profile|issue|ticket))$/i,
      );
    if (scoped) desiredValue = clean(scoped[1]);
  } else {
    if (/^(?:open|go|navigate|visit|read|view)\b/i.test(text))
      operation = "navigate";
    if (/^(?:show|reveal|expand)\b/i.test(text)) operation = "reveal";
    if (
      /^(?:choose|select|enable|disable|switch|change|turn|make)\b/i.test(text)
    )
      operation = "choose";
    if (/^(?:focus|type|enter)\b/i.test(text)) operation = "focus";
    target = text.replace(
      /^(?:open|show|reveal|expand|find|navigate|go|visit|read|view|choose|select|switch|change|turn|make|focus)\s+(?:me\s+)?(?:to\s+)?(?:the\s+)?/i,
      "",
    );
  }
  target = clean(target)
    .replace(/^(?:a|an|the|my|this)\s+/i, "")
    .replace(/\s+(?:control|button|link|option)$/i, "");
  // Generic interface vocabulary; this is independent of website layout/selectors.
  target = target
    .replace(/\bsign in\b|\blog in\b/gi, "login")
    .replace(/\bsign up\b|\bregister\b/gi, "create account");
  const pronoun = /^(?:it|that|this|them)$/i.test(target);
  const compatible =
    reference && ["choose", "reveal", "locate", "navigate"].includes(operation);
  if (pronoun && compatible) target = reference!;
  const scope: TaskIntent["scope"] =
    /\b(?:article|page|website|interface)\b/i.test(target)
      ? "page"
      : /\bsection\b/i.test(target)
        ? "section"
        : "any";
  // Qualifiers remain part of retrieval and must match evidence; never discard them
  // to manufacture a confident semantic match.
  const qualifiers = [
    ...new Set([
      ...(doc.adjectives().out("array") as string[]),
      ...(!desiredValue ? text.match(/\b\d+(?:[.,]\d+)?\b/g) || [] : []),
    ]),
  ]
    .filter(
      (v) =>
        !/^(?:able|possible|sure)$/i.test(v) &&
        !(authenticationIntent(target) === "register" && /^new$/i.test(v)) &&
        !desiredValue?.toLowerCase().includes(v.toLowerCase()),
    )
    .map(sanitizeGoal);
  return {
    id: crypto.randomUUID(),
    original,
    target: sanitizeGoal(target || text || original),
    operation,
    desiredValue,
    qualifiers,
    exclusions: exclusions.map(sanitizeGoal),
    scope,
    status: "pending",
    ...(exclusions.length && !clean(text) ? { negatedOnly: true } : {}),
    ...(pronoun && !compatible ? { needsReference: true } : {}),
  };
}
export { canonicalGoal } from "./canonical";
