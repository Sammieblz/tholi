import { workflowGuideSchema, type WorkflowGuide } from "./workflow-contracts";

export function platformFor(
  origin: string,
): WorkflowGuide["platform"] | undefined {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return;
  }
  const families: [WorkflowGuide["platform"], RegExp][] = [
    ["cloudflare", /(^|\.)cloudflare\.com$/],
    ["github", /(^|\.)github\.com$/],
    ["jira", /(^|\.)(atlassian\.net|jira\.com)$/],
    ["youtube", /(^|\.)youtube\.com$/],
    ["netflix", /(^|\.)netflix\.com$/],
    ["amazon", /(^|\.)amazon\.(com|co\.uk)$/],
  ];
  return families.find(([, pattern]) => pattern.test(host))?.[0];
}
const sources = {
  createRepo: [
    "https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository",
    "0a22e59d13fa8e782c6c73b7052d5f1bd0cd1da4080c5269b8256c3fcb45bfe5",
  ],
  git: [
    "https://developers.cloudflare.com/pages/get-started/git-integration/",
    "a725d6ea9999aab2148d43934108eee3b51e73e2e7023a5a640da7e741418cb6",
  ],
  upload: [
    "https://developers.cloudflare.com/pages/get-started/direct-upload/",
    "3b22ecc11518d6394b207df52ad0df5f4a01105d4156da07a58a5db34c85c300",
  ],
  branch: [
    "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/changing-the-default-branch",
    "737e1b97e9ad26179b3bee28311adf86603d2ed6e155bf8b77c52d8aecad69fe",
  ],
  issue: [
    "https://support.atlassian.com/jira-software-cloud/docs/create-a-work-item-and-a-subtask/",
    "a3f6e6b720b1190bed76ad0655bdeda53769ce8ff6b796ed6fcd656c47069c55",
  ],
  captions: [
    "https://support.google.com/youtube/answer/100078?hl=en",
    "ba28d273df411564bb05f571f73e4c804ae43755508aa584305eb562fdbeaa54",
  ],
  speed: [
    "https://support.google.com/youtube/answer/7509567?hl=en",
    "b09f204dd15469cf06a97171c2e2effdda4c8de372220857d27083b5d8b48893",
  ],
  cancel: [
    "https://help.netflix.com/en/node/407",
    "84c9df08c4bfae00254ca850cc209b3eba602054d8bf5675768d2551bd2a133d",
  ],
  plan: [
    "https://help.netflix.com/en/node/22",
    "6b217bb5faaaa977745117ec8b5251116e41b234f24e31f94d3074f4faff5ea8",
  ],
  prime: [
    "https://www.aboutamazon.com/news/retail/how-to-cancel-amazon-prime-membership",
    "b234e8a3967b7491896aad0ce9acc1cd6ea62e518f85e0d68b48716e031ad823",
  ],
} as const;
type Milestone = WorkflowGuide["milestones"][number];
const step = (
  id: string,
  purpose: string,
  targets: string[],
  kind: Milestone["kind"],
  extra: Partial<Milestone> = {},
): Milestone => ({
  id,
  purpose,
  targets,
  kind,
  instruction: purpose + ". The next screen is checked again.",
  ...extra,
});
const guide = (
  id: string,
  platform: WorkflowGuide["platform"],
  purpose: string,
  intents: string[],
  source: (keyof typeof sources)[],
  milestones: Milestone[],
): WorkflowGuide =>
  workflowGuideSchema.parse({
    id,
    platform,
    purpose,
    intents,
    version:
      id === "amazon.prime.cancel"
        ? "2.0.0"
        : id === "cloudflare.pages.deploy"
          ? "1.2.0"
          : "1.0.0",
    sources: source.map((key) => ({
      url: sources[key][0],
      sha256: sources[key][1],
      reviewedAt: "2026-10-12",
    })),
    milestones,
    scopeEntities:
      platform === "github"
        ? ["repository"]
        : platform === "jira"
          ? ["project"]
          : ["cloudflare", "netflix", "amazon"].includes(platform)
            ? ["account"]
            : [],
    subjects:
      id === "amazon.prime.cancel"
        ? ["Prime", "membership", "subscription"]
        : undefined,
  });
// These describe documented purposes, not scripts. Every target is retrieved and
// bound from the current interface. A guide cannot override a live risk boundary.
export const workflowGuides: WorkflowGuide[] = [
  {
    ...guide(
      "github.repository.create",
      "github",
      "Create a new GitHub repository",
      [
        "create repository",
        "create repo",
        "new repository",
        "new repo",
        "make repository",
        "make repo",
        "start repository",
        "set up repository",
      ],
      ["createRepo"],
      [
        step(
          "creation-menu",
          "Open the creation menu",
          ["Create new", "Create new...", "Create menu"],
          "reveal",
        ),
        step(
          "creation-entry",
          "Open the new repository form",
          ["New repository", "New", "Create a new repository"],
          "navigate",
        ),
        step(
          "repository-form",
          "Enter the requested repository details",
          ["Repository name", "Repository details", "Owner"],
          "input",
          {
            entity: "repository",
            instruction:
              "Enter the requested name and review owner, visibility and initialization settings on GitHub.",
          },
        ),
        step(
          "create-review",
          "Review creation of the requested repository",
          ["Create repository"],
          "review",
        ),
        step(
          "created",
          "Verify the requested new repository",
          ["Repository"],
          "result",
          {
            entity: "repository",
            outcome: ["repository created", "repository successfully created"],
            instruction:
              "Verify the requested owner and repository name; a creation click alone is insufficient.",
          },
        ),
      ],
    ),
    scopeEntities: [],
  },

  guide(
    "cloudflare.pages.deploy",
    "cloudflare",
    "Deploy a website with Cloudflare Pages",
    [
      "deploy web page",
      "deploy webpage",
      "publish web page",
      "publish webpage",
      "deploy website",
      "publish website",
      "host site",
      "host website",
      "put website online",
      "deploy pages",
      "upload website",
    ],
    ["git", "upload"],
    [
      step("workspace-menu", "Open the Compute menu", ["Compute"], "reveal"),
      step(
        "workspace",
        "Open the application's deployment area",
        ["Workers & Pages", "Workers and Pages"],
        "navigate",
      ),
      step(
        "new",
        "Start a Pages application",
        ["Create application", "Create", "Pages", "Get started"],
        "reveal",
      ),
      step(
        "pages",
        "Choose the Pages application flow",
        ["Pages", "Get started", "Looking for Pages"],
        "navigate",
        { context: ["Pages"] },
      ),
      step(
        "git",
        "Connect a Git provider",
        ["Connect to Git", "Import a repository", "GitHub", "Connect GitHub"],
        "navigate",
        { branch: "git" },
      ),
      step(
        "repository",
        "Choose the requested repository",
        ["Repository", "Select repository", "Repositories"],
        "choose",
        { branch: "git", entity: "repository" },
      ),
      step(
        "configuration",
        "Review build configuration",
        [
          "Build settings",
          "Build command",
          "Build output directory",
          "Project name",
        ],
        "input",
        {
          branch: "git",
          entity: "project",
          instruction:
            "Enter and review configuration on the website. Use your project's build command and output directory; Tholi does not invent them.",
        },
      ),
      step(
        "files",
        "Select prebuilt website files",
        [
          "Drag and drop your files",
          "Upload assets",
          "Upload files",
          "Select files",
        ],
        "input",
        {
          branch: "upload",
          instruction:
            "Select your prebuilt website files yourself. Native file pickers and file contents are outside Tholi's observation.",
        },
      ),
      step(
        "deploy",
        "Review deployment",
        ["Save and Deploy", "Deploy site", "Deploy", "Create project"],
        "review",
      ),
      step(
        "result",
        "Verify deployment for the requested project",
        ["Deployment status", "Deployment"],
        "result",
        {
          entity: "project",
          outcome: [
            "deployment successful",
            "deployment success",
            "deployment deployed",
            "deployment active",
          ],
          instruction:
            "Wait for the requested project's deployment result. A submitted deployment or unrelated success message is insufficient.",
        },
      ),
    ],
  ),
  guide(
    "github.repository.settings",
    "github",
    "Find repository settings",
    ["repository settings", "repo settings", "configure repository"],
    ["branch"],
    [
      step(
        "repository",
        "Choose the requested repository",
        ["Repositories", "Repository"],
        "navigate",
        { entity: "repository" },
      ),
      step("settings", "Open repository settings", ["Settings"], "navigate", {
        context: ["Repository"],
      }),
    ],
  ),
  guide(
    "github.branch.change",
    "github",
    "Change a repository's default branch",
    ["change default branch", "switch default branch", "set default branch"],
    ["branch"],
    [
      step("settings", "Open repository settings", ["Settings"], "navigate", {
        context: ["Repository"],
      }),
      step(
        "branch",
        "Find the default branch setting",
        ["Default branch", "Branches"],
        "reveal",
      ),
      step(
        "selection",
        "Choose the requested default branch",
        ["Default branch", "Choose a branch", "Select branch"],
        "choose",
        { entity: "branch" },
      ),
      step(
        "review",
        "Review the default branch change",
        ["Update", "Change default branch", "Confirm"],
        "review",
      ),
      step(
        "result",
        "Verify the requested default branch",
        ["Default branch"],
        "result",
        { entity: "branch", outcome: ["default branch", "updated"] },
      ),
    ],
  ),
  guide(
    "jira.work-item.create",
    "jira",
    "Create a work item in a project",
    [
      "create issue",
      "create ticket",
      "report bug",
      "create work item",
      "add task",
      "file bug",
    ],
    ["issue"],
    [
      step(
        "project",
        "Choose the requested project",
        ["Projects", "Spaces", "Project", "Space"],
        "navigate",
        { entity: "project" },
      ),
      step(
        "form",
        "Open the work item form",
        ["Create", "Create issue", "Create work item"],
        "reveal",
      ),
      step(
        "summary",
        "Enter the work item details",
        ["Summary", "Title"],
        "input",
        {
          entity: "issue",
          instruction:
            "Enter the requested summary and required details on the website. Field focus does not verify their contents.",
        },
      ),
      step(
        "review",
        "Review work item creation",
        ["Create", "Create issue", "Submit"],
        "review",
      ),
      step(
        "result",
        "Verify the requested work item",
        ["Work item", "Issue"],
        "result",
        { entity: "issue", outcome: ["created", "issue", "work item"] },
      ),
    ],
  ),
  guide(
    "youtube.captions.change",
    "youtube",
    "Change video captions language",
    [
      "change captions",
      "spanish subtitles",
      "subtitle language",
      "translate captions",
      "change subtitles",
    ],
    ["captions"],
    [
      step("settings", "Open video player settings", ["Settings"], "reveal", {
        context: ["Video player", "Player"],
      }),
      step(
        "captions",
        "Open the captions choices",
        ["Subtitles/CC", "Subtitles", "Captions"],
        "reveal",
      ),
      step(
        "translation",
        "Open translated caption choices if needed",
        ["Auto-translate"],
        "reveal",
      ),
      step(
        "language",
        "Choose the requested captions language",
        ["Language", "Subtitles", "Captions"],
        "choose",
        { entity: "language" },
      ),
      step(
        "result",
        "Verify the captions language",
        ["Subtitles", "Captions"],
        "result",
        { entity: "language", outcome: ["subtitles", "captions"] },
      ),
    ],
  ),
  guide(
    "youtube.speed.change",
    "youtube",
    "Change video playback speed",
    ["playback speed", "watch faster", "slow video", "video speed"],
    ["speed"],
    [
      step("settings", "Open video player settings", ["Settings"], "reveal", {
        context: ["Video player", "Player"],
      }),
      step(
        "speed",
        "Open playback speed choices",
        ["Playback speed", "Speed"],
        "reveal",
      ),
      step(
        "value",
        "Choose the requested playback speed",
        ["Playback speed", "Speed"],
        "choose",
        { entity: "speed" },
      ),
      step(
        "result",
        "Verify playback speed",
        ["Playback speed", "Speed"],
        "result",
        { entity: "speed", outcome: ["speed"] },
      ),
    ],
  ),
  guide(
    "netflix.plan.change",
    "netflix",
    "Change Netflix membership plan",
    [
      "change plan",
      "upgrade plan",
      "downgrade plan",
      "switch plan",
      "different plan",
    ],
    ["plan"],
    [
      step(
        "account",
        "Open membership settings",
        ["Account", "Manage membership", "Membership"],
        "navigate",
      ),
      step(
        "plans",
        "Open available plans",
        ["Change Plan", "Change plan"],
        "navigate",
      ),
      step("plan", "Choose the requested plan", ["Plan"], "choose", {
        entity: "plan",
      }),
      step(
        "review",
        "Review the plan change",
        ["Continue", "Update", "Confirm Change", "Confirm"],
        "review",
      ),
      step(
        "result",
        "Verify the requested membership plan",
        ["Plan", "Membership"],
        "result",
        { entity: "plan", outcome: ["plan", "changed", "scheduled"] },
      ),
    ],
  ),
  guide(
    "netflix.membership.cancel",
    "netflix",
    "Cancel Netflix membership",
    [
      "cancel subscription",
      "cancel membership",
      "stop netflix",
      "end subscription",
      "unsubscribe netflix",
    ],
    ["cancel"],
    [
      step(
        "account",
        "Open membership settings",
        ["Account", "Manage membership", "Membership"],
        "navigate",
      ),
      step(
        "cancel",
        "Open cancellation review",
        ["Cancel", "Cancel membership"],
        "navigate",
      ),
      step(
        "review",
        "Review final membership cancellation",
        ["Finish Cancellation", "Confirm cancellation", "End membership"],
        "review",
      ),
      step(
        "result",
        "Verify membership cancellation",
        ["Membership", "Cancellation"],
        "result",
        {
          outcome: [
            "membership canceled",
            "membership cancelled",
            "cancellation confirmed",
            "membership ends",
          ],
        },
      ),
    ],
  ),
  guide(
    "amazon.prime.cancel",
    "amazon",
    "Cancel Amazon Prime membership",
    [
      "cancel prime",
      "end prime",
      "cancel membership",
      "cancel subscription",
      "stop prime",
    ],
    ["prime"],
    [
      step(
        "account",
        "Open your account membership area",
        ["Account & Lists", "Accounts & Lists", "Your Account", "Account"],
        "navigate",
      ),
      step(
        "prime",
        "Open Prime membership",
        [
          "Prime",
          "Prime membership",
          "Your Prime Membership",
          "Manage Prime Membership",
        ],
        "navigate",
      ),
      step(
        "manage",
        "Open membership management",
        ["Manage membership", "Manage", "Update, Cancel and More"],
        "reveal",
      ),
      step(
        "review",
        "Review final Prime cancellation",
        [
          "End membership",
          "End benefits",
          "Confirm cancellation",
          "Cancel membership",
          "Continue to cancel",
          "Continue with cancellation",
          "Cancel My Benefits",
          "End My Benefits",
          "End on renewal",
          "End Now",
        ],
        "review",
      ),
      step(
        "result",
        "Verify Prime cancellation",
        ["Prime membership", "Membership"],
        "result",
        {
          outcome: [
            "membership canceled",
            "membership cancelled",
            "membership ends",
            "cancellation confirmed",
            "prime membership has ended",
            "prime membership will end",
          ],
        },
      ),
    ],
  ),
];

// An explicit interface vocabulary is the only persisted text on private apps.
// Unknown labels (including object names) remain session-only.
export const interfaceVocabulary = new Set(
  [
    ...workflowGuides.flatMap((g) => [
      g.purpose,
      ...g.milestones.map((m) => m.purpose),
    ]),
    ...workflowGuides.flatMap((g) => g.milestones.flatMap((m) => m.targets)),
    "Search",
    "Search videos",
    "Search Amazon",
    "Search Netflix",
    "Search projects",
    "Search issues",
    "Search repositories",
    "Filter",
    "Filters",
    "Sort",
    "Sort by",
    "Next",
    "Back",
    "Close",
    "Cancel",
    "Help",
    "Menu",
    "Log in",
    "Sign in",
    "Create account",
    "Password",
    "Email",
    "Summary",
    "Description",
  ].map((v) => v.toLowerCase()),
);
