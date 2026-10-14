import "./marketing.css";
import { SiteLink } from "../../app/router";
import { Demo } from "../demo/Demo";
export function HomePage() {
  return (
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
            <SiteLink to="/download" className="web-primary">
              Get Tholi
            </SiteLink>
            <SiteLink to="/about" className="web-text-link">
              Meet your guide
            </SiteLink>
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
          Through menus, dialogs, sign-in, and the next screen. Tholi keeps the
          task in view and checks your progress as you go.
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
            One instruction and a visual highlight. You choose and perform the
            website action.
          </p>
        </article>
        <article>
          <h3>Room for your preferences</h3>
          <p>
            A sidebar or a movable widget. A direct guide or a conversation.
            Advanced tools when you want them.
          </p>
        </article>
        <article>
          <h3>Local by default</h3>
          <p>
            The installed extension processes requests locally. An account and a
            backend are optional.
          </p>
        </article>
      </section>
      <section className="faq">
        <h2>A few things to know</h2>
        <details>
          <summary>Does Tholi work on every website?</summary>
          <p>
            Tholi discovers live controls on ordinary HTTP and HTTPS pages. Some
            dashboards and workflows remain unreliable, especially when controls
            are inaccessible or the next screen is unknown. It explains missing
            evidence and keeps your destination.
          </p>
        </details>
        <details>
          <summary>Is this a cloud AI assistant?</summary>
          <p>
            No. The default path uses local NLP, page discovery, and OCR when
            needed. Conversation mode presents grounded navigation, not
            general-purpose LLM answers.
          </p>
        </details>
        <details>
          <summary>Does it click or enter passwords for me?</summary>
          <p>
            No. You perform website interactions and authentication. Tholi can
            scroll and highlight a freshly bound target.
          </p>
        </details>
      </section>
      <section className="closing">
        <h2>Your next step, made clear.</h2>
        <SiteLink to="/download" className="web-primary">
          Get Tholi
        </SiteLink>
      </section>
    </>
  );
}
