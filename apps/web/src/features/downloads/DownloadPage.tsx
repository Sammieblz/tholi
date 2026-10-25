import { useEffect, useState } from "react";
import { SiteLink, useRouter } from "../../app/router";
import {
  browsers,
  selectedBrowser,
  stores,
  type ExtensionTarget,
} from "./browsers";
import {
  ArrowRight,
  Check,
  Download,
  Folder,
  ShieldCheck,
} from "iconoir-react";
import packageMetadata from "../../../../../package.json";
import { repositoryUrl } from "../../config/project";
import { DownloadButton, StoreLink, useDownload } from "./downloads";
import "./downloads.css";

const chromiumSteps = [
  {
    title: "Download and unzip",
    text: "Save the ZIP, then extract it to a folder you will keep. Your browser loads the folder, so leave it in place after setup.",
  },
  {
    title: "Open extensions",
    text: "Open the extension manager shown above and turn on Developer mode.",
  },
  {
    title: "Load unpacked",
    text: "Select Load unpacked. Choose the extracted extension folder, then confirm that Tholi appears in your extension list.",
  },
  {
    title: "Choose a destination",
    text: "Open a website and click the Tholi toolbar icon. Allow website access if your browser asks, then tell your guide what you want to do.",
  },
];
function InstallIllustration({
  step,
  firefox = false,
}: {
  step: number;
  firefox?: boolean;
}) {
  return (
    <div
      className={`install-illustration install-illustration-${step}`}
      data-reveal-part
      aria-label={
        step === 3
          ? "Actual Tholi Guide interface capture"
          : "Illustrated installation step"
      }
    >
      {step === 0 ? (
        <>
          <div className="install-file">
            <Download aria-hidden="true" />
            <span>
              Tholi developer build<span className="small">ZIP archive</span>
            </span>
          </div>
          <ArrowRight className="install-flow-arrow" aria-hidden="true" />
          <Folder className="install-folder" aria-hidden="true" />
        </>
      ) : step === 1 ? (
        <div className="install-chrome-panel">
          <div>
            <strong>{firefox ? "about:debugging" : "Extensions"}</strong>
            {!firefox && (
              <span className="install-toggle" aria-hidden="true">
                <i />
              </span>
            )}
          </div>
          <span>{firefox ? "This Firefox" : "Developer mode"}</span>
        </div>
      ) : step === 2 ? (
        <div className="install-chrome-panel">
          <span className="install-load">
            {firefox ? "Load Temporary Add-on" : "Load unpacked"}
          </span>
          <div className="install-tholi">
            <img
              src="/media/tholi_brand_logo.png"
              width="66"
              height="27"
              alt="Tholi"
            />
            <Check width={18} aria-hidden="true" />
          </div>
        </div>
      ) : (
        <img
          className="install-product"
          src="/media/screenshots/guide-panel.webp"
          alt="The working Tholi Guide interface"
          width="420"
          height="760"
          loading="lazy"
        />
      )}
    </div>
  );
}
export function DownloadPage() {
  const { search, hash } = useRouter();
  const targeted =
    new URLSearchParams(search).has("browser") ||
    /^#(?:installation-|developer-installation$)/.test(hash);
  const [developerOpen, setDeveloperOpen] = useState(targeted);
  useEffect(() => {
    if (targeted) setDeveloperOpen(true);
  }, [targeted, search, hash]);
  return (
    <section className="download-page">
      <div className="download-heading" data-reveal="heading">
        <div>
          <p className="eyebrow">YOUR GUIDE, ONE TAB AWAY</p>
          <h1>
            Your browser.
            <br />A clearer way forward.
          </h1>
          <p className="web-intro">
            A small guide for the things you came to do. Choose your browser,
            add Tholi, and tell it where you want to go.
          </p>
          <p className="download-promise">
            <ShieldCheck aria-hidden="true" /> Local by default. No Tholi
            account required.
          </p>
        </div>
        <div className="download-intro-note" data-reveal-part>
          <img
            src="/media/tholi_brand_logo.png"
            alt="Tholi"
            width="120"
            height="48"
          />
          <p>
            One destination.
            <br />
            One helpful next step.
          </p>
          <span>Chrome & Firefox · Desktop extension</span>
        </div>
      </div>
      <div className="browser-install-options" aria-label="Choose a browser">
        {(["chromium", "firefox"] as const).map((target) => {
          const store = stores[target];
          const browser = browsers.find((item) => item.id === store.id)!;
          return (
            <article
              className="browser-install-card"
              key={target}
              data-reveal="sequence"
            >
              <div className="browser-card-top" data-reveal-part>
                <img
                  src={`/media/browsers/${store.id}.svg`}
                  width="64"
                  height="64"
                  alt=""
                />
                <span className="browser-store-status">Available now</span>
              </div>
              <h2>Tholi for {store.name}</h2>
              <p>
                {target === "chromium"
                  ? "A little direction, right beside your tabs."
                  : "Your next step, with your browser still yours."}
              </p>
              <StoreLink
                target={target}
                describedBy={`${store.id}-install-note`}
              />
              <p
                id={`${store.id}-install-note`}
                className="browser-install-note"
              >
                Opens {store.listing}. {browser.minimum}+ on desktop. Your
                browser confirms installation.
              </p>
            </article>
          );
        })}
      </div>
      <section aria-labelledby="store-setup-title">
        <div className="install-heading" data-reveal="heading">
          <p className="eyebrow">YOUR FIRST FEW STEPS</p>
          <h2 id="store-setup-title">Make room for a guide.</h2>
          <p>
            Install from your browser’s store, then start on a website you want
            help with.
          </p>
        </div>
        <ol className="install-grid store-install-grid">
          <li data-reveal="sequence">
            <div
              className="install-illustration store-install-logos"
              aria-hidden="true"
            >
              <img
                src="/media/browsers/chrome.svg"
                alt=""
                width="64"
                height="64"
              />
              <img
                src="/media/browsers/firefox.svg"
                alt=""
                width="64"
                height="64"
              />
            </div>
            <span className="install-number">01</span>
            <h3>Add from the store</h3>
            <p>
              Choose Chrome or Firefox above. Review the listing and
              permissions, then confirm in your browser. Opening a listing does
              not install Tholi.
            </p>
          </li>
          <li data-reveal="sequence">
            <div className="install-illustration" aria-hidden="true">
              <div className="install-chrome-panel">
                <span>Extensions</span>
                <div className="install-tholi">
                  <img
                    src="/media/tholi_brand_logo.png"
                    width="66"
                    height="27"
                    alt=""
                  />
                  <span>Pin to toolbar</span>
                </div>
              </div>
            </div>
            <span className="install-number">02</span>
            <h3>Open your guide</h3>
            <p>
              Find Tholi in your browser’s Extensions menu. Pin it to the
              toolbar for easy access, then select its icon to open the guide.
            </p>
          </li>
          <li data-reveal="sequence">
            <InstallIllustration step={3} />
            <span className="install-number">03</span>
            <h3>Choose a destination</h3>
            <p>
              On the website you want help with, grant website access when
              asked. Tell Tholi what you want to do and start guidance. You make
              the clicks and confirm consequential actions.
            </p>
          </li>
        </ol>
      </section>
      <div className="web-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          You choose which websites Tholi can access. Pause or stop guidance
          whenever you need. Processing stays local by default; connecting your
          own private backend is optional.
        </p>
      </div>
      <details
        className="developer-installation"
        id="developer-installation"
        open={developerOpen}
        onToggle={(event) => setDeveloperOpen(event.currentTarget.open)}
      >
        <summary>Developer installation</summary>
        <noscript>
          <p>
            Developer metadata needs JavaScript. See the{" "}
            <a href={repositoryUrl}>source repository</a> for build
            instructions. Store links above work without JavaScript.
          </p>
        </noscript>
        {developerOpen && <DeveloperInstallation />}
      </details>
      <div className="download-next-step" data-reveal="closing">
        <div>
          <h2>Want to look around first?</h2>
          <p>Get a feel for Tholi with a short practice before installing.</p>
        </div>
        <SiteLink className="web-secondary" to="/onboarding">
          Try the guide
        </SiteLink>
      </div>
    </section>
  );
}

function DeveloperInstallation() {
  const { go, search, hash } = useRouter();
  const browser = selectedBrowser(search, hash);
  const firefox = browser.target === "firefox";
  const download = useDownload(browser.target as ExtensionTarget),
    release = download.release;
  const steps = firefox
    ? [
        {
          title: "Download and unzip",
          text: "Extract the Firefox developer preview ZIP to a folder. It is an unsigned development build, not a permanent installation.",
        },
        {
          title: "Open This Firefox",
          text: "Open about:debugging, then select This Firefox.",
        },
        {
          title: "Load Temporary Add-on",
          text: "Choose Load Temporary Add-on and select manifest.json in dist/extension-firefox or the extracted Firefox preview folder.",
        },
        {
          title: "Choose a destination",
          text: "Click the Tholi toolbar icon on a website. Approve its website access when asked, then enter your destination. Temporary installation is removed when Firefox restarts.",
        },
      ]
    : chromiumSteps;
  return (
    <section
      className="manual-installation"
      id={`installation-${browser.id}`}
      tabIndex={-1}
      aria-labelledby="installation-title"
    >
      <div className="install-heading" data-reveal="heading">
        <p className="eyebrow">FOR DEVELOPERS</p>
        <h2 id="installation-title">Manual installation</h2>
        <p>
          Use these builds for local development. Choose your browser for the
          matching ZIP and manual directions. Store installation above is the
          recommended path for everyday use.
        </p>
      </div>
      <div className="download-card" data-reveal="surface">
        <span className="download-platform">DEVELOPER BUILD</span>
        <div className="browser-choice">
          <label htmlFor="tholi-download-browser">Your browser</label>
          <select
            id="tholi-download-browser"
            value={browser.id}
            onChange={(event) => {
              const next = browsers.find(
                (item) => item.id === event.target.value,
              )!;
              go("/download?browser=" + next.id);
            }}
          >
            {browsers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <p>
          {firefox ? "Firefox developer build" : "Chromium developer build"} ·{" "}
          {browser.minimum} or newer
        </p>
        <p className="small">
          {browser.verification === "capability-dependent"
            ? "Compatibility depends on the required browser capabilities."
            : "Native installation certification is pending for this browser."}
        </p>
        <p>
          Extension manager: <code>{browser.manager}</code>
        </p>
        <DownloadButton download={download} />
        {release && (
          <>
            <strong>Developer build {release.version}</strong>
            <span>
              {(release.bytes / 1048576).toFixed(1)} MB ZIP ·{" "}
              {firefox ? "Temporary installation" : "Unpacked installation"}
            </span>
          </>
        )}
        <p>Local processing. Your browser, your control.</p>
      </div>
      {release && (
        <div className="download-evidence">
          <p>
            {release.version === packageMetadata.version
              ? "This package matches the current extension source version. Signed-in website workflow verification remains in progress."
              : `The UI development version is ${packageMetadata.version}. This developer download is an earlier package; use its recorded version and checksum.`}
          </p>
          <details>
            <summary>Version and checksum</summary>
            <p>
              Packaged version {release.version} · {release.status}
            </p>
            <code>{release.sha256}</code>
          </details>
        </div>
      )}
      <ol className="install-grid">
        {steps.map((step, index) => (
          <li key={step.title}>
            <InstallIllustration step={index} firefox={firefox} />
            <span className="install-number">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
      <details className="source-instructions">
        <summary>Build the latest interface from source</summary>
        <p>From the repository, using Node 24.19.x:</p>
        <pre>npm ci{"\n"}npm run build:extension</pre>
        <p>
          Load{" "}
          <code>
            {firefox
              ? "dist/extension-firefox/manifest.json"
              : "dist/extension"}
          </code>{" "}
          using the selected instructions. After rebuilding, reload Tholi and
          refresh the website tab. Browser installations keep separate local
          knowledge.
        </p>
        <a className="web-text-link" href={repositoryUrl}>
          View source repository
        </a>
      </details>
    </section>
  );
}
