import "./downloads.css";
import packageMetadata from "../../../../../package.json";
import {
  ArrowRight,
  Download,
  Folder,
  Check,
  ShieldCheck,
} from "iconoir-react";
import { DownloadButton, useDownload } from "./downloads";

const steps = [
  {
    title: "Download and unzip",
    text: "Save the ZIP, then extract it to a folder you will keep. Chrome loads the folder, so leave it in place after setup.",
  },
  {
    title: "Open extensions",
    text: "In desktop Chrome, open chrome://extensions. Turn on Developer mode in the upper-right corner.",
  },
  {
    title: "Load unpacked",
    text: "Select Load unpacked. Choose the extracted extension folder, then confirm that Tholi appears in your extension list.",
  },
  {
    title: "Choose a destination",
    text: "Open a website and click the Tholi toolbar icon. Allow website access if Chrome asks, then tell your guide what you want to do.",
  },
];
function InstallIllustration({ step }: { step: number }) {
  return (
    <div
      className={`install-illustration install-illustration-${step}`}
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
            <strong>Extensions</strong>
            <span className="install-toggle" aria-hidden="true">
              <i />
            </span>
          </div>
          <span>Developer mode</span>
        </div>
      ) : step === 2 ? (
        <div className="install-chrome-panel">
          <span className="install-load">Load unpacked</span>
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
  const download = useDownload(),
    release = download.release;
  return (
    <section className="download-page">
      <div className="download-heading">
        <div>
          <p className="eyebrow">YOUR GUIDE, ONE TAB AWAY</p>
          <h1>
            A little direction.
            <br />
            Right in Chrome.
          </h1>
          <p className="web-intro">
            Install the Tholi preview, open a website, and start with the thing
            you want to do. No account required.
          </p>
        </div>
        <div className="download-card">
          <span className="download-platform">THOLI FOR DESKTOP CHROME</span>
          <DownloadButton download={download} />
          {release && (
            <>
              <strong>Preview {release.version}</strong>
              <span>
                {(release.bytes / 1048576).toFixed(1)} MB ZIP · Unpacked
                installation
              </span>
            </>
          )}
          <p>Local processing. You make every website click.</p>
        </div>
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
      <div className="install-heading">
        <p className="eyebrow">A FEW MINUTES TO SET UP</p>
        <h2>Give your guide a place to start.</h2>
        <p>
          Preview installation uses Chrome’s unpacked extension tools. The setup
          illustrations below explain the process; the final image is captured
          from the real extension.
        </p>
      </div>
      <ol className="install-grid">
        {steps.map((step, index) => (
          <li key={step.title}>
            <InstallIllustration step={index} />
            <span className="install-number">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
      <div className="web-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          Chrome Web Store installation is not available in this preview.
          Chrome-required permissions need your approval. Sign-in and website
          changes remain on the website.
        </p>
      </div>
      <details className="source-instructions">
        <summary>Build the latest interface from source</summary>
        <p>From the repository, using Node 24.19.x:</p>
        <pre>npm ci{"\n"}npm run build:extension</pre>
        <p>
          Load the generated <code>dist/extension</code> folder. After
          rebuilding, reload Tholi in Chrome and refresh your website tab.
        </p>
        <a
          className="web-text-link"
          href="https://github.com/Sammieblz/web-navigator"
        >
          View source repository <ArrowRight width={17} aria-hidden="true" />
        </a>
      </details>
    </section>
  );
}
