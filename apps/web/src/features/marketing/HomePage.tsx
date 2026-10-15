import "./marketing.css";
import { SiteLink } from "../../app/router";
import { Demo } from "../demo/Demo";
import { ProductCapture } from "./ProductCapture";
export function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-heading">
            <p className="eyebrow">
              <span className="tholi-dot" />
              YOUR GUIDE THROUGH THE WEB
            </p>
            <h1>
              Find your way
              <br />
              <span>forward.</span>
            </h1>
          </div>
          <div className="hero-overview">
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
        </div>
        <div className="hero-product">
          <div className="capture-context">
            <span>FROM THE RUNNING EXTENSION · WIKIPEDIA</span>
            <span>“Make the text larger”</span>
          </div>
          <ProductCapture
            name="live-guidance"
            title="The next step, right where you need it."
            description="A real Tholi session on Wikipedia. The movable widget keeps the request in view while the highlight points to the text-size control."
            width={1440}
            height={960}
            eager
          />
        </div>
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
      <section className="product-views">
        <div className="product-views-copy">
          <p className="eyebrow">TWO WAYS TO FIND YOUR WAY</p>
          <h2>
            Less interface.
            <br />
            More direction.
          </h2>
          <p>
            Keep one clear instruction in Guide, or ask about the current step
            in Conversation. Both follow the same journey.
          </p>
          <p>
            These are captures of the actual extension interfaces, with the same
            public-page request.
          </p>
        </div>
        <ProductCapture
          name="guide-panel"
          title="One step at a time"
          description="The extension’s Guide view keeps the destination, current instruction, and Pause / Stop together."
          width={420}
          height={760}
          panel
        />
        <ProductCapture
          name="conversation-panel"
          title="A little more context"
          description="“Why this step?” shows the available route evidence. Conversation runs locally, without a cloud chatbot."
          width={420}
          height={760}
          panel
        />
      </section>
      <section className="verified-preview">
        <ProductCapture
          name="verified-arrival"
          title="A change checked on the page"
          description="In this captured session, selecting Large changes Wikipedia’s text size. Tholi verifies the preference before showing Arrived."
          width={1440}
          height={960}
        />
        <div className="verified-preview-copy">
          <p className="eyebrow">PROGRESS YOU CAN SEE</p>
          <h2>
            A click is a step.
            <br />A checked outcome is arrival.
          </h2>
          <p>
            You make the website changes. Tholi checks for evidence of the
            requested result and keeps an unfinished destination in view.
          </p>
          <p className="capture-credits">
            Captured with Tholi 0.10.1 on public Wikipedia.{" "}
            <a
              href="https://en.wikipedia.org/wiki/Ada_Lovelace"
              target="_blank"
              rel="noreferrer"
            >
              Article and image credits
            </a>
            . These screenshots demonstrate this preference change, not
            reliability on every website.
          </p>
        </div>
      </section>
      <section className="try-demo">
        <div>
          <p className="eyebrow">TRY THE FEEL OF IT</p>
          <h2>A small practice run.</h2>
          <p>
            Open the account menu and follow the guide. This interactive sample
            is a safe demonstration, separate from the extension screenshots
            above.
          </p>
          <p className="small">No installation or account needed.</p>
        </div>
        <Demo />
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
