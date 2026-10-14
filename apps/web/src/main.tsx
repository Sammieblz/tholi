import { useEffect, useState } from "react";
import packageMetadata from "../../../package.json";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  Download,
  Check,
  NavArrowRight,
  Menu,
  Xmark,
} from "iconoir-react";
import { Dialog } from "@base-ui/react/dialog";
import "../../../packages/ui/tokens.css";
import "./style.css";
interface DownloadManifest {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  status: string;
}
type Account = { name: string; email: string; onboarded: boolean };
function readAccount(): Account | undefined {
  try {
    return (
      JSON.parse(sessionStorage.getItem("tholi-demo-account") || "null") ||
      undefined
    );
  } catch {
    return;
  }
}
function Demo({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState(0);
  const instructions = [
    "Open your account menu.",
    "Choose account settings.",
    "Your account settings are open.",
  ];
  return (
    <div className="demo" aria-label="Interactive Tholi demonstration">
      <div className="demo-caption">
        <span className="tholi-dot" />
        Interactive demonstration. This is a sample website.
      </div>
      <div className="demo-browser">
        <div className="demo-top">
          <span>Sample workspace</span>
          <button
            onClick={() => setStep(1)}
            className={step === 0 ? "demo-target" : ""}
          >
            Account menu
          </button>
        </div>
        <div className="demo-workspace">
          <div>
            <span className="small">YOUR WORKSPACE</span>
            <h3>
              {step === 2 ? "Account settings" : "A little less searching."}
            </h3>
            <p>
              {step === 2
                ? "You arrived at the requested screen."
                : "A clear next step, right where you need it."}
            </p>
          </div>
          {step === 1 && (
            <div className="demo-menu">
              <button
                className="demo-target"
                onClick={() => {
                  setStep(2);
                  onDone?.();
                }}
              >
                Account settings
              </button>
              <span className="small">Help and support</span>
            </div>
          )}
        </div>
      </div>
      <div className="demo-guide">
        <img src="/media/tholi_brand_logo.png" alt="Tholi" />
        <span role="status" aria-live="polite">
          {step === 2 ? <Check width={20} /> : <span className="tholi-dot" />}
          {instructions[step]}
        </span>
        <button onClick={() => setStep(0)}>
          {step === 2 ? "Try again" : "Restart demo"}
        </button>
      </div>
    </div>
  );
}
function App() {
  const [path, setPath] = useState(location.pathname),
    [account, setAccount] = useState<Account | undefined>(readAccount),
    [download, setDownload] = useState<DownloadManifest>(),
    [menu, setMenu] = useState(false);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [onboarding, setOnboarding] = useState(0),
    [previewMode, setPreviewMode] = useState("Guide");
  useEffect(() => {
    const change = () => setPath(location.pathname);
    addEventListener("popstate", change);
    fetch("/downloads/manifest.json")
      .then((r) => (r.ok ? r.json() : undefined))
      .then(setDownload)
      .catch(() => {});
    return () => removeEventListener("popstate", change);
  }, []);
  const go = (next: string) => {
    history.pushState({}, "", next);
    setPath(next);
    setMenu(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        document.title = `${heading.textContent?.trim() || "Tholi"} | Tholi`;
      }
    });
  };
  const save = (a: Account) => {
    sessionStorage.setItem("tholi-demo-account", JSON.stringify(a));
    setAccount(a);
  };
  const signOut = () => {
    sessionStorage.removeItem("tholi-demo-account");
    setAccount(undefined);
    setPassword("");
    setEmail("");
    setName("");
    go("/");
  };
  const auth = async () => {
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter an email address, such as you@example.com.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for the demo password.");
      return;
    }
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 180));
      save({
        name: name.trim() || email.split("@")[0],
        email,
        onboarded: path === "/signin",
      });
      setPassword("");
      go(path === "/signup" ? "/onboarding" : "/welcome");
    } catch {
      setError(
        "The demo session could not be saved. Allow browser session storage or continue without an account.",
      );
    } finally {
      setLoading(false);
    }
  };
  const complete = () => {
    if (account) save({ ...account, onboarded: true });
    go("/welcome");
  };
  const link = (href: string, label: string, className?: string) => (
    <a
      href={href}
      aria-label={label || "Tholi home"}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        go(href);
      }}
    >
      {label}
    </a>
  );
  const downloadButton = download ? (
    <a className="web-primary" href={download.url} download>
      <Download width={19} />
      Download extension preview
    </a>
  ) : (
    <span className="small" role="status">
      No packaged download is available. Build instructions are below.
    </span>
  );
  return (
    <>
      <header className="web-header">
        {link("/", "", "brand-link")}
        <img
          className="web-logo"
          src="/media/tholi_brand_logo.png"
          alt="Tholi"
        />
        <nav aria-label="Main navigation">
          {link("/download", "Get Tholi")}
          {link("/about", "About")}
          {account ? link("/welcome", "Welcome") : link("/signin", "Sign in")}
          {!account && link("/signup", "Get started", "web-primary")}
        </nav>
        <Dialog.Root open={menu} onOpenChange={setMenu}>
          <Dialog.Trigger
            className="mobile-menu icon-button"
            aria-label="Open navigation"
          >
            <Menu />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="web-backdrop" />
            <Dialog.Popup className="web-mobile-dialog">
              <Dialog.Title>Explore Tholi</Dialog.Title>
              <Dialog.Close
                className="icon-button"
                aria-label="Close navigation"
              >
                <Xmark />
              </Dialog.Close>
              {link("/download", "Get Tholi")}
              {link("/about", "About")}
              {link(
                account ? "/welcome" : "/signin",
                account ? "Welcome" : "Sign in",
              )}
              {!account && link("/signup", "Get started")}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </header>
      <main className="web-main">
        {path === "/" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="tholi-dot" />
                  YOUR GUIDE THROUGH THE WEB
                </p>
                <h1>
                  Find your way
                  <br />
                  <span>forward.</span>
                </h1>
                <p className="hero-description">
                  Unfamiliar menus. Hidden settings. One clear next step.
                  <br />
                  Tell Tholi where you want to go, and follow the guide.
                </p>
                <div className="hero-actions">
                  {link("/download", "Get Tholi", "web-primary")}
                  {link("/about", "Meet your guide", "web-text-link")}
                </div>
                <p className="small">
                  Chrome extension · Local processing · You make every click
                </p>
              </div>
              <Demo />
            </section>
            <section className="story-band">
              <h2>Your destination stays with you.</h2>
              <p>
                Through menus, dialogs, sign-in, and the next screen. Tholi
                keeps the task in view and checks your progress as you go.
              </p>
            </section>
            <section className="use-cases">
              <div>
                <p className="eyebrow">A LITTLE LESS SEARCHING</p>
                <h2>Start with what you want to do.</h2>
              </div>
              <div className="example-requests">
                <p>“Show me my account settings.”</p>
                <p>“Help me change the language to Spanish.”</p>
                <p>“Where do I manage my membership?”</p>
                <span className="small">
                  Examples of destinations, not guarantees for every website.
                </span>
              </div>
            </section>
            <section className="principles">
              <article>
                <h3>A guide beside you</h3>
                <p>
                  One instruction and a visual highlight. You choose and perform
                  the website action.
                </p>
              </article>
              <article>
                <h3>Room for your preferences</h3>
                <p>
                  A sidebar or a movable widget. A direct guide or a
                  conversation. Advanced tools when you want them.
                </p>
              </article>
              <article>
                <h3>Local by default</h3>
                <p>
                  The installed extension processes requests locally. An account
                  and a backend are optional.
                </p>
              </article>
            </section>
            <section className="faq">
              <h2>A few things to know</h2>
              <details>
                <summary>Does Tholi work on every website?</summary>
                <p>
                  Tholi discovers live controls on ordinary HTTP and HTTPS
                  pages. Some dashboards and workflows remain unreliable,
                  especially when controls are inaccessible or the next screen
                  is unknown. It explains missing evidence and keeps your
                  destination.
                </p>
              </details>
              <details>
                <summary>Is this a cloud AI assistant?</summary>
                <p>
                  No. The default path uses local NLP, page discovery, and OCR
                  when needed. Conversation mode presents grounded navigation,
                  not general-purpose LLM answers.
                </p>
              </details>
              <details>
                <summary>Does it click or enter passwords for me?</summary>
                <p>
                  No. You perform website interactions and authentication. Tholi
                  can scroll and highlight a freshly bound target.
                </p>
              </details>
            </section>
            <section className="closing">
              <h2>Your next step, made clear.</h2>
              {link("/download", "Get Tholi", "web-primary")}
            </section>
          </>
        )}
        {path === "/about" && (
          <section className="reading">
            <p className="eyebrow">MEET THOLI</p>
            <h1>
              A patient guide
              <br />
              beside you.
            </h1>
            <p>
              Tholi helps you find the next step through unfamiliar software,
              rather than taking control of it.
            </p>
            <h2>Inspired by umtholi.</h2>
            <p>
              The name comes from the founder’s naming brief. The shortened name
              expresses the idea of finding your way.
            </p>
            <h2>Capable, and honest.</h2>
            <p>
              Tholi searches what it can observe and checks outcomes. It can
              still miss controls or lack a route. The current product is a
              preview, with signed-in workflow verification still in progress.
            </p>
            <h2>Your browser remains yours.</h2>
            <p>
              Reusable interface knowledge stays local. Form values and
              screenshots are not stored. Authentication remains on the website.
              This demo website has no analytics or real account service.
            </p>
            {link("/download", "Try the extension preview", "web-primary")}
          </section>
        )}
        {path === "/download" && (
          <section className="download-page">
            <p className="eyebrow">GET THOLI</p>
            <h1>A guide in your browser.</h1>
            <p className="hero-description">
              Install the extension preview in desktop Chrome. No account
              needed.
            </p>
            {downloadButton}
            {download && (
              <div className="download-evidence">
                <strong>Packaged version {download.version}</strong>
                <p>
                  {download.version === packageMetadata.version
                    ? "This package includes the current Tholi redesign. Signed-in workflow verification remains in progress."
                    : "The current UI development version is " +
                      packageMetadata.version +
                      ". This download is the earlier packaged preview until the redesigned build passes release checks."}
                </p>
                <details>
                  <summary>Verify your download</summary>
                  <p>
                    {(download.bytes / 1048576).toFixed(1)} MB ZIP ·{" "}
                    {download.status}
                  </p>
                  <code>{download.sha256}</code>
                </details>
              </div>
            )}
            <div className="install-grid">
              {[
                {
                  title: "Download and unzip",
                  text: "Extract the ZIP to a folder you will keep. Chrome loads that folder.",
                  visual: "tholi-preview.zip → extension folder",
                },
                {
                  title: "Open extensions",
                  text: "Visit chrome://extensions and turn on Developer mode.",
                  visual: "Extensions   Developer mode ☑",
                },
                {
                  title: "Load unpacked",
                  text: "Select Load unpacked, then choose the extracted extension folder.",
                  visual: "[ Load unpacked ]   [ Tholi ]",
                },
                {
                  title: "Open your destination",
                  text: "Pin Tholi if you wish. Open a website, click its toolbar icon, and enter a destination.",
                  visual: "Tholi   What would you like to do?",
                },
              ].map((s, i) => (
                <article key={s.title}>
                  <div
                    className="install-sketch"
                    aria-label="Illustrative installation step"
                  >
                    {s.visual}
                  </div>
                  <span className="small">Step {i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </article>
              ))}
            </div>
            <details>
              <summary>Build the latest UI from source</summary>
              <p>From the repository, with Node 24.19.x:</p>
              <pre>npm ci{"\n"}npm run build:extension</pre>
              <p>
                Load the generated <code>dist/extension</code> folder. After
                rebuilding, reload Tholi in Chrome and refresh your website tab.
              </p>
              <a href="https://github.com/Sammieblz/web-navigator">
                View source repository
                <ArrowRight width={17} />
              </a>
            </details>
            <p className="small">
              Chrome Web Store installation is not available in this preview.
              Chrome-required permissions need your approval.
            </p>
          </section>
        )}
        {(path === "/signup" || path === "/signin") && (
          <section className="auth-card tholi-surface">
            <p className="eyebrow">DEMO ACCOUNT</p>
            <h1>
              {path === "/signup" ? "A clear place to start." : "Welcome back."}
            </h1>
            <p className="small">
              This is a local mock flow. Use example details, not real
              credentials. No account is created and nothing is sent.
            </p>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void auth();
              }}
            >
              {path === "/signup" && (
                <label>
                  Name{" "}
                  <input
                    autoComplete="off"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                </label>
              )}
              <label>
                Email{" "}
                <input
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Demo password{" "}
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                />
              </label>
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
              <button className="primary" disabled={loading}>
                {loading
                  ? "Opening your demo account"
                  : path === "/signup"
                    ? "Create demo account"
                    : "Sign in to demo"}
              </button>
            </form>
            <p>
              {path === "/signup"
                ? link("/signin", "Already exploring? Sign in to the demo")
                : link("/signup", "New here? Create a demo account")}
            </p>
            {link("/download", "Get the extension without an account")}
          </section>
        )}
        {path === "/onboarding" && (
          <section className="onboarding">
            <p className="eyebrow">YOUR FIRST STEPS</p>
            <h1>
              {onboarding === 0
                ? "Make room for a guide."
                : "Try one clear step."}
            </h1>
            <p className="small">
              Optional demo onboarding · {onboarding + 1} of 2
            </p>
            {onboarding === 0 ? (
              <>
                <p>
                  Install Tholi, then try a destination on a website. You’ll
                  approve website access when Chrome needs it.
                </p>
                {downloadButton}
                <p>{link("/download", "See installation steps")}</p>
                <fieldset>
                  <legend>Website preview preference</legend>
                  <p className="small">
                    This changes the demo only. Set your installed extension’s
                    preferences inside Tholi.
                  </p>
                  {["Guide", "Conversation"].map((m) => (
                    <label key={m}>
                      <input
                        type="radio"
                        name="preview-mode"
                        checked={previewMode === m}
                        onChange={() => setPreviewMode(m)}
                      />
                      {m}
                    </label>
                  ))}
                </fieldset>
                <button className="primary" onClick={() => setOnboarding(1)}>
                  Try the demonstration
                  <NavArrowRight width={18} />
                </button>
              </>
            ) : (
              <>
                <p>
                  Use the highlighted account menu, then choose account
                  settings. This demonstration has no real website effects.
                </p>
                <Demo />
                <button className="primary" onClick={complete}>
                  Finish onboarding
                </button>
              </>
            )}
            <button className="text-button" onClick={complete}>
              Skip onboarding
            </button>
          </section>
        )}
        {path === "/welcome" && (
          <section className="welcome">
            <p className="eyebrow">DEMO WELCOME AREA</p>
            <h1>
              {account ? `Hello, ${account.name}.` : "Find your first step."}
            </h1>
            <p>
              Your destination is the starting point. No route history or
              extension data is connected to this demo account.
            </p>
            <div className="welcome-actions">
              {link("/download", "Install Tholi", "web-primary")}
              <button
                onClick={() => {
                  setOnboarding(0);
                  go("/onboarding");
                }}
              >
                Replay onboarding
              </button>
              {account && <button onClick={signOut}>Sign out</button>}
            </div>
            <Demo />
          </section>
        )}
        {![
          "/",
          "/about",
          "/download",
          "/signup",
          "/signin",
          "/onboarding",
          "/welcome",
        ].includes(path) && (
          <section className="reading">
            <h1>This page isn’t here.</h1>
            {link("/", "Return to Tholi")}
          </section>
        )}
      </main>
      <footer className="web-footer">
        <img src="/media/tholi_brand_logo.png" alt="Tholi" />
        <span>Find your way forward.</span>
        <div>
          {link("/about", "About and privacy")}
          {link("/download", "Download and setup")}
          <a href="https://github.com/Sammieblz/web-navigator">Source</a>
        </div>
        <small>Local preview · Mock accounts · No analytics</small>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
