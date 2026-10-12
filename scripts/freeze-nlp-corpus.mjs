// Authoring utility only. CI reads the committed corpus and checksum; it never
// regenerates expected targets from implementation predictions.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const targets = [
  "Log in",
  "Create account",
  "Languages",
  "Spanish",
  "Dark",
  "Large",
  "References",
  "Contents",
  "Search",
  "Edit",
  "View history",
  "Appearance",
  "Wide",
  "Tools",
  "Donate",
  "Download",
  "Help",
  "Contact",
  "Settings",
  "Notifications",
];
const phrases = [
  (t) => `Please show me ${t}.`,
  (t) => `Can you help me find ${t}?`,
  (t) => `I want to open ${t}.`,
  (t) => `How do I open ${t}?`,
  (t) => `Could you guide me to ${t}, please?`,
  (t) => `I would like to find ${t} on this page.`,
];
const cases = [];
function add(category, text, expected, options = {}) {
  const index = cases.filter((v) => v.category === category).length;
  cases.push({
    id: `${category}-${String(index + 1).padStart(3, "0")}`,
    category,
    split: index % 5 >= 3 ? "held-out" : "calibration",
    fixture: options.fixture || "generic",
    text,
    expected,
    ...options,
  });
}
for (const target of targets)
  for (const phrase of phrases)
    add("positive", phrase(target), target, {
      fixture: targets.indexOf(target) < 14 ? "wikipedia" : "generic",
    });
for (let i = 0; i < 10; i++)
  add(
    "negation-correction",
    `Open ${targets[i]} but not ${targets[(i + 3) % 20]}.`,
    targets[i],
  );
for (let i = 0; i < 10; i++)
  add(
    "negation-correction",
    `Open ${targets[(i + 3) % 20]}, actually open ${targets[i]}.`,
    targets[i],
  );
for (const text of [
  "Open settings",
  "Show settings",
  "Find my settings",
  "Can you help me find settings?",
  "I want to open settings",
  "Where are settings?",
  "Go to settings",
  "Please show settings",
  "I would like to find settings",
  "Show me the settings",
  "Open Search",
  "Find Search",
  "Show Search",
  "I want to use Search",
  "Help me find Search",
  "Could you show Search?",
  "Please open Search",
  "Go to Search",
  "Locate Search",
  "Show me Search",
])
  add("ambiguous", text, "clarification", {
    fixture: "ambiguous",
    duplicate: /search/i.test(text) ? "Search" : "Settings",
  });
for (const text of [
  "Book a flight to Paris",
  "Order a pizza",
  "Send an email to my boss",
  "Tell me the weather tomorrow",
  "Calculate my taxes",
  "Summarize the entire article",
  "Translate the whole article automatically",
  "Write a poem",
  "Track my shipment",
  "Play a song",
  "Install an application",
  "Create a spreadsheet",
  "Automatically click every link",
  "Pay my bill",
  "Delete my account",
  "Purchase a membership",
  "Submit my changes",
  "Transfer money to another bank",
  "Cancel my subscription",
  "Enter my password",
])
  add("unsupported", text, "unsupported");
const compounds = [
  "Open Languages and then choose Spanish",
  "Open Appearance and then choose Dark",
  "Open Contents and then find References",
  "Open Tools and then find Download",
  "Open Settings and then open Notifications",
  "Open Languages then change it to Spanish",
  "Open Appearance then show it",
  "Open Search and then open Help",
  "Find Contact and then find Help",
  "Open Contents then find References then open View history",
];
for (const text of compounds)
  add("compound-context", text, "queue", {
    tasks: text.match(/\bthen\b/g)?.length + 1 || 2,
  });
for (const text of [
  "Change it to Spanish",
  "Show it",
  "Open that",
  "Choose it",
  "Find it",
])
  add("compound-context", text, "reference", {
    context: { target: "Languages" },
  });
for (const text of [
  "Change it to Spanish",
  "Show it",
  "Open that",
  "Choose it",
  "Find it",
])
  add("compound-context", text, "unsupported");
if (cases.length !== 200)
  throw new Error("Corpus must contain exactly 200 cases");
const bytes =
  JSON.stringify(
    {
      version: 1,
      annotations:
        "Expected targets authored independently of model scores. Wikipedia labels checked against the existing live matrix; generic targets use authored accessible controls.",
      cases,
    },
    null,
    2,
  ) + "\n";
await mkdir("tests/nlp", { recursive: true });
await writeFile("tests/nlp/corpus.json", bytes);
await writeFile(
  "tests/nlp/corpus.sha256",
  createHash("sha256").update(bytes).digest("hex") + "\n",
);
