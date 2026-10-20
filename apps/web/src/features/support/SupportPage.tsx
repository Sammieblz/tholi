import { SiteLink } from "../../app/router";
import "./support.css";

const paths = [
  {
    number: "01",
    title: "Make yourself at home.",
    text: "Choose your browser and follow the illustrated installation steps.",
    label: "Install Tholi",
    to: "/download",
  },
  {
    number: "02",
    title: "Find your way around.",
    text: "Get to know Guide, Conversation and the controls that keep you in charge.",
    label: "Using your guide",
    to: "/docs/using-tholi",
  },
  {
    number: "03",
    title: "Keep your browser yours.",
    text: "Understand website access, local processing and Tholi’s boundaries.",
    label: "Permissions and privacy",
    to: "/docs/security",
  },
];

export function SupportPage() {
  return (
    <section className="help-page support-page">
      <div className="help-heading" data-reveal="heading">
        <p className="eyebrow">THOLI SUPPORT</p>
        <h1>
          A little help, <br />
          when you need it.
        </h1>
        <p className="web-intro">
          Getting set up, finding your next step or figuring out what happened.
          Start here. We’ll help you find your way.
        </p>
      </div>
      <div className="support-paths" aria-label="Support resources">
        {paths.map((path) => (
          <article key={path.number} data-reveal="heading">
            <p className="eyebrow">
              {path.number} / {path.label}
            </p>
            <h2>{path.title}</h2>
            <p>{path.text}</p>
            <SiteLink to={path.to} className="web-text-link">
              {path.label}
            </SiteLink>
          </article>
        ))}
      </div>
      <div className="support-answers">
        <div data-reveal="heading">
          <p className="eyebrow">A FEW USEFUL ANSWERS</p>
          <h2>
            Let’s get you
            <br />
            unstuck.
          </h2>
          <p>Small checks that often make the next step clearer.</p>
        </div>
        <div className="support-questions">
          <details>
            <summary>Tholi isn’t showing guidance on a website.</summary>
            <p>
              Open an ordinary HTTP or HTTPS website and select the Tholi
              toolbar icon. Check the browser’s website-access setting and grant
              access when asked. Browser settings pages and other restricted
              pages do not support guidance. After updating the extension,
              refresh the website tab.
            </p>
            <SiteLink to="/docs/getting-started" className="web-text-link">
              Check installation and access
            </SiteLink>
          </details>
          <details>
            <summary>The next step is unclear or has stopped changing.</summary>
            <p>
              Check whether guidance is paused or waiting for your answer. Let a
              changing page settle, then resume. You can clarify your
              destination in your own words or stop and start a new one. Some
              websites and longer workflows remain unsupported.
            </p>
            <SiteLink to="/docs/troubleshooting" className="web-text-link">
              Troubleshoot guidance
            </SiteLink>
          </details>
          <details>
            <summary>Firefox removed Tholi after a restart.</summary>
            <p>
              The current manual Firefox setup uses a temporary add-on. Firefox
              removes it when the browser restarts. Follow the Firefox setup
              steps to load it again while the store listing is being prepared.
            </p>
            <SiteLink
              to="/download?browser=firefox#installation-firefox"
              className="web-text-link"
            >
              Firefox setup
            </SiteLink>
          </details>
          <details>
            <summary>Do I need an account to use Tholi?</summary>
            <p>
              No. You can install and use the extension without an account.
              Account pages on this website are local demonstrations for now.
            </p>
            <SiteLink to="/download" className="web-text-link">
              Get the extension
            </SiteLink>
          </details>
        </div>
      </div>
      <div className="support-contact" data-reveal="closing">
        <div>
          <p className="eyebrow">THERE’S A PERSON ON THE OTHER SIDE</p>
          <h2>Still need a hand?</h2>
          <p>
            Tell us which browser and Tholi version you’re using, what you
            expected and what happened instead. A short description is enough to
            start.
          </p>
        </div>
        <SiteLink to="/contact?topic=support" className="web-primary">
          Contact support
        </SiteLink>
      </div>
    </section>
  );
}
