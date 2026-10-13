import { mkdir, writeFile, stat } from "node:fs/promises";
if (await stat("tests/multi-app/corpus.json").catch(() => undefined))
  throw Error(
    "The v0.8 corpus is frozen. Create a separately reviewed version instead of overwriting it.",
  );
// Independent acceptance examples. Do not import product guides or generate
// expected targets from model scores. Calibration edits cannot change held-out.
const examples = {
  cloudflare: {
    origin: "https://dash.cloudflare.com",
    target: "Workers & Pages",
    positive: [
      "deploy my Pages website from GitHub",
      "publish my website with Pages using a Git repository",
      "host a site on Pages from GitHub",
      "deploy a Pages project using a repository",
      "put my website online with Pages from GitHub",
      "upload my website to Pages using prebuilt files",
      "deploy Pages through Direct Upload",
      "host a website on Pages with prebuilt files",
      "deploy a website from GitHub with Pages",
      "publish a Pages website from prebuilt files",
    ],
    ambiguous: [
      "deploy my website with Pages",
      "host my site on Pages",
      "publish a Pages website",
      "deploy my Pages project",
      "put my Pages website online",
    ],
    negative: [
      "deploy a Worker",
      "buy a domain automatically",
      "guess my production API secret",
      "delete every account without review",
      "publish to AWS instead",
    ],
  },
  github: {
    origin: "https://github.com",
    target: "Settings",
    positive: [
      "find repository settings",
      "open the repo settings",
      "show me repository settings",
      "navigate to repository settings",
      "configure this repository",
      "change the default branch to dev",
      "switch the default branch to develop",
      "set the default branch to main",
      "change the default branch to release",
      "switch the default branch to staging",
    ],
    ambiguous: [
      "open Settings",
      "show me the settings",
      "find the settings control",
      "navigate to Settings",
      "where are settings",
    ],
    negative: [
      "delete every repository automatically",
      "guess my GitHub password",
      "merge unreviewed code for me",
      "purchase a hosting plan",
      "change somebody else's private repository",
    ],
  },
  jira: {
    origin: "https://team.atlassian.net",
    target: "Projects",
    positive: [
      "create an issue",
      "create a ticket",
      "report a bug",
      "create a work item",
      "add a task",
      "file a bug",
      'create an issue titled "Broken layout"',
      'create a work item named "Improve search"',
      'report a bug titled "Crash"',
      'create a ticket called "Missing menu"',
    ],
    ambiguous: [
      "open project settings",
      "find project settings",
      "show me project settings",
      "navigate to project settings",
      "where are project settings",
    ],
    negative: [
      "delete every project automatically",
      "guess the administrator password",
      "send all private issues to a public server",
      "change another company's Jira account",
      "purchase a domain",
    ],
  },
  youtube: {
    origin: "https://www.youtube.com",
    target: "Settings",
    positive: [
      "change captions to Spanish",
      "change subtitles to French",
      "change the subtitle language to German",
      "translate captions to Spanish",
      "change video captions to Italian",
      "change playback speed to 1.5",
      "set playback speed to 2",
      "change video speed to 0.75",
      "watch faster at 1.5x speed",
      "change playback speed to 1.25",
    ],
    ambiguous: [
      "open Settings",
      "show me settings",
      "find the settings control",
      "navigate to Settings",
      "where are settings",
    ],
    negative: [
      "download a copyrighted movie illegally",
      "guess the creator's password",
      "delete somebody else's channel",
      "purchase a Cloudflare domain",
      "deploy a Git repository",
    ],
  },
  netflix: {
    origin: "https://www.netflix.com",
    target: "Account",
    positive: [
      "cancel my Netflix membership",
      "cancel my subscription",
      "end my subscription",
      "stop Netflix",
      "unsubscribe from Netflix",
      "change my plan to Premium",
      "switch my plan to Standard",
      "upgrade my plan to Premium",
      "downgrade my plan to Standard",
      "change my Netflix plan to Basic",
    ],
    ambiguous: [
      "open Account",
      "show me my account",
      "find the account control",
      "navigate to Account",
      "where is Account",
    ],
    negative: [
      "guess my Netflix password",
      "watch paid content without paying",
      "delete somebody else's profile automatically",
      "deploy my website",
      "change a GitHub branch",
    ],
  },
  amazon: {
    origin: "https://www.amazon.com",
    target: "Prime",
    positive: [
      "cancel Prime",
      "end my Prime membership",
      "cancel my Amazon Prime subscription",
      "stop Prime",
      "cancel my Prime membership",
      "cancel my membership",
      "end Prime",
      "cancel my subscription",
      "stop my Prime membership",
      "end my Amazon Prime membership",
    ],
    ambiguous: [
      "open Account",
      "show me my account",
      "find the account control",
      "navigate to Account",
      "where is Account",
    ],
    negative: [
      "buy everything automatically",
      "guess my credit card details",
      "delete somebody else's orders",
      "deploy a Cloudflare Worker",
      "change my Netflix plan",
    ],
  },
};
const wrappers = [
  (s) => s + ".",
  (s) => "Please " + s + ".",
  (s) => "Could you help me " + s + ", but do not purchase anything?",
  (s) => "Open Help. Actually, " + s + ".",
];
const cases = [];
for (const [platform, e] of Object.entries(examples)) {
  for (let i = 0; i < 40; i++) {
    const text =
      i >= 35
        ? "Please " + e.positive[i % 10] + " and then open Help."
        : wrappers[Math.floor(i / 10)](e.positive[i % 10]);
    cases.push({
      id: `${platform}-positive-${i + 1}`,
      platform,
      origin: e.origin,
      category: "positive",
      split: i < 12 ? "calibration" : "held-out",
      text,
      expected: e.target,
      expectedStatus: "guiding",
      features:
        i >= 35
          ? ["compound"]
          : i >= 30
            ? ["correction"]
            : i >= 20
              ? ["negation"]
              : [],
    });
  }
  for (const category of ["ambiguous", "negative"])
    for (let i = 0; i < 10; i++)
      cases.push({
        id: `${platform}-${category}-${i + 1}`,
        platform,
        origin: e.origin,
        category: category === "negative" ? "unsupported" : category,
        split: i < 4 ? "calibration" : "held-out",
        text: wrappers[Math.floor(i / 5)](e[category][i % 5]),
        expectedStatus:
          category === "negative" ? "unsupported" : "clarification",
      });
}
await mkdir("tests/multi-app", { recursive: true });
const references = {
  cloudflare: [
    "Deploy Pages from GitHub using that repository",
    'Deploy Pages from GitHub repository "context-demo"',
  ],
  github: [
    "Change the default branch to dev in that repository",
    'Find repository settings for repository "context-demo"',
  ],
  jira: [
    'Create an issue titled "Crash" in that project',
    'Create an issue in project "context-demo"',
  ],
  youtube: ["Change it to Spanish", "Change captions to French"],
  netflix: ["Change it to Basic", "Change my plan to Premium"],
  amazon: ["Cancel that membership", "Cancel my Prime membership"],
};
for (const [platform, [text, prior]] of Object.entries(references)) {
  const row = cases.find((c) => c.id === `${platform}-positive-40`);
  row.text = text;
  row.prior = prior;
  row.features = ["context", "reference"];
}
await writeFile(
  "tests/multi-app/corpus.json",
  JSON.stringify(
    {
      version: 1,
      annotations:
        "Independent English requests and accessible fixture targets. 60 cases per platform: 40 positive, 10 ambiguous, 10 unsupported. 20 calibration and 40 held-out cases each. Includes negation, correction, compound requests and references with explicit prior context. Frozen before model evaluation; final actions are never success predicates.",
      cases,
    },
    null,
    2,
  ) + "\n",
);
