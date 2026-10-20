import "./marketing.css";
import { SiteLink } from "../../app/router";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { Demo } from "../demo/Demo";
import { ProductCapture } from "./ProductCapture";
import { ProductVideo } from "./ProductVideo";
import { ScrollCompanion } from "./ScrollCompanion";

export function HomePage() {
  return (
    <div className="home-page">
      <ScrollCompanion />
      <section className="hero chapter-inner">
        <div className="hero-heading">
          <p className="eyebrow">A LITTLE DIRECTION GOES A LONG WAY</p>
          <h1>
            Find your way
            <br />
            <span>forward.</span>
          </h1>
        </div>
        <div className="hero-overview">
          <span className="hero-static-marker">
            <Wayfinder state="idle" />
          </span>
          <p className="hero-description">
            You know where you want to go.
            <br />
            The next click should feel obvious.
          </p>
          <p>
            Tell Tholi your destination. Follow a clear instruction and a
            highlight on the website, with your goal kept in view as the page
            changes.
          </p>
          <div className="hero-actions">
            <SiteLink to="/download" className="web-primary">
              Get Tholi
            </SiteLink>
            <SiteLink to="/#practice" className="web-secondary">
              Try it here
            </SiteLink>
          </div>
          <p className="small">
            For Chrome, Edge, Brave, compatible Chromium browsers and Firefox.
            Local processing. No account required.
          </p>
        </div>
      </section>
      <section className="product-chapter" aria-label="Tholi in action">
        <div className="chapter-inner" data-reveal="media">
          <div className="chapter-caption">
            <span>THE REAL EXTENSION, IN ACTION</span>
            <span>One request. A visible next step.</span>
          </div>
          <ProductVideo />
        </div>
      </section>
      <section className="explanation-chapter">
        <div className="chapter-inner">
          <div className="section-heading" data-reveal="heading">
            <div>
              <p className="eyebrow">FROM INTENTION TO ACTION</p>
              <h2>
                A familiar feeling.
                <br />
                On an unfamiliar website.
              </h2>
            </div>
            <p>
              No need to know what a website calls its menus. Start with what
              you came to do.
            </p>
          </div>
          <ol className="three-steps">
            <li data-reveal="sequence">
              <span className="step-number">01</span>
              <h3>Say the destination.</h3>
              <p>
                “Find my account settings.” “Make the text larger.” Use your own
                words, and correct the request along the way.
              </p>
            </li>
            <li data-reveal="sequence">
              <span className="step-number">02</span>
              <h3>See the next step.</h3>
              <p>
                Tholi looks at the available interface. A grounded instruction
                and a highlight help you find the right control.
              </p>
            </li>
            <li data-reveal="sequence">
              <span className="step-number">03</span>
              <h3>Make the click.</h3>
              <p>
                You stay in control. Tholi watches for the requested result
                before it calls the journey complete.
              </p>
            </li>
          </ol>
        </div>
      </section>
      <section className="practice-chapter" id="practice">
        <div className="chapter-inner">
          <div className="section-heading" data-reveal="heading">
            <div>
              <p className="eyebrow">TAKE IT FOR A SMALL SPIN</p>
              <h2>
                A little practice.
                <br />A real feel for the guide.
              </h2>
            </div>
            <p>
              Try finding settings or changing a sample language. This is the
              actual shared Tholi interface, with a controlled local adapter.
              Nothing changes a real account.
            </p>
          </div>
          <Demo />
        </div>
      </section>
      <section className="continuity-chapter">
        <div className="chapter-inner continuity-layout">
          <div className="continuity-copy" data-reveal="heading">
            <p className="eyebrow">THE DESTINATION STAYS WITH YOU</p>
            <h2>
              More than a<br />
              single next click.
            </h2>
            <p>
              Menus open. Pages change. Sign-in gets in the way. Tholi retains
              your request and looks for fresh evidence on each screen.
            </p>
            <p>
              Guide keeps the next action concise. Conversation keeps the
              request, corrections and route explanations together. Switching
              views keeps the same journey.
            </p>
            <SiteLink className="web-text-link" to="/docs/journeys">
              How continuous journeys work
            </SiteLink>
          </div>
          <div className="interface-pair" data-reveal="media">
            <ProductCapture
              name="guide-panel"
              title="Clear, at a glance"
              description="The actual Guide interface, with the destination and current website instruction together."
              width={420}
              height={760}
              panel
            />
            <ProductCapture
              name="conversation-panel"
              title="Room for context"
              description="The actual local Conversation interface explaining its navigation evidence through “Why this step?”"
              width={420}
              height={760}
              panel
            />
          </div>
        </div>
      </section>
      <section className="ownership-chapter">
        <div className="chapter-inner">
          <div className="ownership-heading" data-reveal="heading">
            <p className="eyebrow">YOUR BROWSER REMAINS YOURS</p>
            <h2>
              A guide beside you.
              <br />
              The controls in your hands.
            </h2>
          </div>
          <div className="ownership-columns">
            <div data-reveal="sequence">
              <h3>Local by default.</h3>
              <p>
                Navigation, language processing and visual assistance run on
                your device. An optional backend is your choice, with no
                required cloud model or background upload service.
              </p>
              <SiteLink to="/privacy" className="web-text-link">
                Read how your data is handled
              </SiteLink>
            </div>
            <div data-reveal="sequence">
              <h3>Arrival needs evidence.</h3>
              <p>
                A click or an open menu is a step, not proof of a finished task.
                You perform website actions, including sign-in and any
                consequential changes. Tholi checks the requested result.
              </p>
              <SiteLink to="/docs/security" className="web-text-link">
                Understand the boundaries
              </SiteLink>
            </div>
          </div>
          <div className="evidence-gallery" data-reveal="media">
            <ProductCapture
              name="live-guidance"
              title="The next step, right where you need it."
              description="A genuine Tholi session on public Wikipedia. The widget keeps the request close while the page highlight identifies the text-size control."
              width={1440}
              height={960}
            />
            <ProductCapture
              name="verified-arrival"
              title="A change checked on the page"
              description="Selecting Large changes Wikipedia’s text size. Tholi checks the preference before showing Arrived."
              width={1440}
              height={960}
            />
          </div>
          <p className="capture-credits">
            Actual extension captures on public Wikipedia.{" "}
            <a
              href="https://en.wikipedia.org/wiki/Ada_Lovelace"
              target="_blank"
              rel="noreferrer"
            >
              Article and image credits
            </a>
            . One working example does not establish reliability on every
            website.
          </p>
        </div>
      </section>
      <section className="faq-chapter">
        <div className="chapter-inner faq" data-reveal="heading">
          <div>
            <p className="eyebrow">BEFORE YOU FIND YOUR WAY</p>
            <h2>
              A helpful guide.
              <br />
              An honest preview.
            </h2>
            <p>Useful direction includes knowing what still needs work.</p>
            <SiteLink to="/docs" className="web-text-link">
              Explore the documentation
            </SiteLink>
          </div>
          <div>
            <details>
              <summary>Will it work on my website?</summary>
              <p>
                Tholi discovers live controls on ordinary HTTP and HTTPS pages.
                Some dashboards and longer workflows remain unreliable,
                especially when controls are inaccessible or a future screen is
                unknown. A clearer interface does not remove those limitations.
              </p>
            </details>
            <details>
              <summary>Does it click or sign in for me?</summary>
              <p>
                You click, choose and authenticate on the website. Tholi can
                scroll a fresh target into view and highlight it. Passwords and
                two-factor codes stay on the website.
              </p>
            </details>
            <details>
              <summary>Is Conversation a cloud chatbot?</summary>
              <p>
                No. It presents actual navigation events and route evidence
                using the local pipeline. General-purpose LLM answers are not
                part of this preview.
              </p>
            </details>
            <details>
              <summary>Do I need an account?</summary>
              <p>
                No account is needed to download or use the extension. The
                account and onboarding flows on this website are labeled local
                demonstrations.
              </p>
            </details>
            <details>
              <summary>What happens when a route is unclear?</summary>
              <p>
                The destination stays retained while Tholi searches for grounded
                evidence. It may need a clarification or renewed browser access.
                It cannot promise a route where the available interface does not
                support one.
              </p>
            </details>
          </div>
        </div>
      </section>
      <section className="closing-chapter">
        <div className="chapter-inner closing" data-reveal="closing">
          <div>
            <p className="eyebrow">A LITTLE HELP, RIGHT THERE</p>
            <h2>
              Your next step,
              <br />
              made clear.
            </h2>
            <p>
              Choose the desktop Chromium or Firefox preview. No account needed.
            </p>
          </div>
          <SiteLink to="/download" className="web-primary">
            Find your way with Tholi
          </SiteLink>
        </div>
      </section>
    </div>
  );
}
