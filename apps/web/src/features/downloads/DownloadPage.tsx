import { useRouter } from "../../app/router";
import { SiteLink } from "../../app/router";
import { browsers, selectedBrowser, type ExtensionTarget } from "./browsers";
import {
  ArrowRight,
  Check,
  Download,
  Folder,
  ShieldCheck,
} from "iconoir-react";
import packageMetadata from "../../../../../package.json";
import { repositoryUrl } from "../../config/project";
import { DownloadButton, useDownload } from "./downloads";
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
              Tholi preview<span className="small">ZIP archive</span>
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
  const { go, search } = useRouter();
  const browser = selectedBrowser(search);
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
            <ShieldCheck aria-hidden="true" /> Local by default. No account
            required.
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
        {(
          [
            {
              id: "chrome",
              name: "Chrome",
              text: "A little direction, right beside your tabs.",
              minimum: browsers.find((item) => item.id === "chrome")!.minimum,
            },
            {
              id: "firefox",
              name: "Firefox",
              text: "Your next step, with your browser still yours.",
              minimum: browsers.find((item) => item.id === "firefox")!.minimum,
            },
          ] as const
        ).map((option) => (
          <article
            className="browser-install-card"
            key={option.id}
            data-reveal="sequence"
          >
            <div className="browser-card-top" data-reveal-part>
              <img
                src={`/media/browsers/${option.id}.svg`}
                width="64"
                height="64"
                alt=""
              />
              <span className="browser-store-status">
                Store listing coming soon
              </span>
            </div>
            <h2>Tholi for {option.name}</h2>
            <p>{option.text}</p>
            <SiteLink
              className="web-primary"
              to={`/download?browser=${option.id}#installation-${option.id}`}
              aria-describedby={`${option.id}-install-note`}
            >
              Add to {option.name}
            </SiteLink>
            <p
              id={`${option.id}-install-note`}
              className="browser-install-note"
            >
              Preview button: opens manual setup below, not a store listing.{" "}
              {option.minimum}+ on desktop.
              {option.id === "firefox" &&
                " Temporary installation lasts until Firefox restarts."}
            </p>
          </article>
        ))}
      </div>
      <section
        className="manual-installation"
        id={`installation-${browser.id}`}
        tabIndex={-1}
        aria-labelledby="installation-title"
      >
        <div className="install-heading" data-reveal="heading">
          <p className="eyebrow">YOUR FIRST FEW STEPS</p>
          <h2 id="installation-title">Let’s get you set up.</h2>
          <p>
            While the store listings are being prepared, you can install the
            developer preview yourself. Choose your browser for the matching
            package and illustrated directions. Firefox uses a temporary
            installation.
          </p>
        </div>
        <div className="download-card" data-reveal="surface">
          <span className="download-platform">DESKTOP BROWSER PREVIEW</span>
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
            {firefox
              ? "Firefox developer preview"
              : "Chromium developer preview"}{" "}
            · {browser.minimum} or newer
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
              <strong>Preview {release.version}</strong>
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
                ? "This package includes the current Tholi interface. Signed-in workflow verification remains in progress."
                : `The UI development version is ${packageMetadata.version}. This download is the earlier packaged preview until the redesigned build passes release checks.`}
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
      </section>
      <div className="web-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          You choose which websites Tholi can access. Pause or stop guidance
          whenever you need. Website sign-in and consequential changes stay with
          you. Store buttons currently demonstrate the intended entry points;
          these downloads use manual developer installation.
        </p>
      </div>
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
      <div className="download-next-step" data-reveal="closing">
        <div>
          <h2>Want to look around first?</h2>
          <p>Get a feel for Tholi with a short practice before installing.</p>
        </div>
        <SiteLink className="web-secondary" to="/#practice">
          Try the guide
        </SiteLink>
      </div>
    </section>
  );
}
