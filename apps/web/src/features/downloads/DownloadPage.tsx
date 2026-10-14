import "./downloads.css";
import packageMetadata from "../../../../../package.json";
import { ArrowRight } from "iconoir-react";
import { DownloadButton, useDownload } from "./downloads";
export function DownloadPage() {
  const download = useDownload();
  return (
    <section className="download-page">
      <p className="eyebrow">GET THOLI</p>
      <h1>A guide in your browser.</h1>
      <p className="hero-description">
        Install the extension preview in desktop Chrome. No account needed.
      </p>
      <DownloadButton download={download} />
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
              {(download.bytes / 1048576).toFixed(1)} MB ZIP · {download.status}
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
  );
}
