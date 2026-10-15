import "./marketing.css";
import { ArrowRight, ArrowDown } from "iconoir-react";
import { SiteLink } from "../../app/router";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { Demo } from "../demo/Demo";
import { ProductCapture } from "./ProductCapture";
export function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-heading">
            <p className="eyebrow">A LITTLE DIRECTION GOES A LONG WAY</p>
            <h1>
              Find your way
              <br />
              <span>forward.</span>
            </h1>
          </div>
          <div className="hero-overview">
            <p className="hero-description">
              You know what you want to do. Finding the right menu should be the
              easy part.
            </p>
            <p>
              Tell Tholi your destination. Get a clear next step, a highlight on
              the website, and a guide that keeps your task in view as the
              screen changes.
            </p>
            <div className="hero-actions">
              <SiteLink to="/download" className="web-primary">
                Get Tholi <ArrowRight aria-hidden="true" />
              </SiteLink>
              <a href="#practice" className="web-text-link">
                Try it here{" "}
                <span className="web-link-arrow">
                  <ArrowDown width={15} aria-hidden="true" />
                </span>
              </a>
            </div>
            <p className="small">
              Desktop Chrome · Local processing · Your clicks, your control
            </p>
          </div>
        </div>
        <div className="hero-product">
          <div className="capture-context">
            <span>
              <Wayfinder state="guiding" animate={false} />
              THE RUNNING EXTENSION
            </span>
            <span>Wikipedia · “Make the text larger”</span>
          </div>
          <ProductCapture
            name="live-guidance"
            title="The next step, right where you need it."
            description="A real Tholi session on public Wikipedia. The widget keeps the destination close while a page highlight identifies the text-size control."
            width={1440}
            height={960}
            eager
          />
        </div>
      </section>
      <section className="story-band">
        <h2>
          A destination.
          <br />
          Not another thing to remember.
        </h2>
        <p>
          Some tasks take more than one screen. Tholi retains the objective
          through menus, dialogs, and sign-in, then looks for the next grounded
          step. If the evidence is missing, your task stays unfinished while it
          finds a way forward.
        </p>
      </section>
      <section className="try-demo" id="practice">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TAKE A SMALL DETOUR</p>
            <h2>
              Try the guide.
              <br />
              Make the clicks yourself.
            </h2>
          </div>
          <p>
            Find account settings or switch the sample website to Spanish. This
            practice uses the same interface as the extension, with a controlled
            local adapter. Nothing here changes a real account.
          </p>
        </div>
        <Demo />
      </section>
      <section className="product-views">
        <div className="product-views-copy">
          <p className="eyebrow">YOUR WAY TO ASK</p>
          <h2>
            One guide.
            <br />
            Two ways to talk.
          </h2>
          <p>
            Guide keeps attention on the current instruction. Conversation gives
            your request, corrections, and next steps room to breathe.
          </p>
          <p>
            The journey stays the same when you switch. The current local
            assistant explains its navigation evidence, rather than inventing
            general answers.
          </p>
        </div>
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
          title="A conversation with direction"
          description="The actual local Conversation interface explaining the current route through “Why this step?”"
          width={420}
          height={760}
          panel
        />
      </section>
      <section className="use-cases">
        <div>
          <p className="eyebrow">START WITH THE DESTINATION</p>
          <h2>
            Say what you need.
            <br />
            Skip the menu vocabulary.
          </h2>
          <p className="use-case-intro">
            Ask in an ordinary sentence. Tholi uses the interface it can observe
            to find a relevant control, retain your request, and check what
            happens next.
          </p>
        </div>
        <div className="example-requests">
          <p>“Show me my account settings.”</p>
          <p>“Change the language to Spanish.”</p>
          <p>“Where do I manage my membership?”</p>
          <span className="small">
            Examples of destinations. Coverage varies by website and workflow.
          </span>
        </div>
      </section>
      <section className="verified-preview">
        <ProductCapture
          name="verified-arrival"
          title="A change checked on the page"
          description="In this real session, selecting Large changes Wikipedia’s text size. Tholi checks the preference before showing Arrived."
          width={1440}
          height={960}
        />
        <div className="verified-preview-copy">
          <p className="eyebrow">ARRIVAL MEANS SOMETHING</p>
          <h2>
            A click is a step.
            <br />
            Evidence is arrival.
          </h2>
          <p>
            Opening a menu does not finish a bigger task. Tholi looks for the
            requested result. You stay responsible for website actions,
            especially changes that need review.
          </p>
          <p className="capture-credits">
            Actual extension captures on public Wikipedia.{" "}
            <a
              href="https://en.wikipedia.org/wiki/Ada_Lovelace"
              target="_blank"
              rel="noreferrer"
            >
              Article and image credits
            </a>
            . This preference change demonstrates one working case, not
            guaranteed reliability on every website.
          </p>
        </div>
      </section>
      <section className="faq">
        <div>
          <p className="eyebrow">A FEW THINGS TO KNOW</p>
          <h2>
            A helpful guide.
            <br />
            An honest preview.
          </h2>
          <p>
            Useful direction starts with knowing what the product can see, and
            what still needs work.
          </p>
        </div>
        <div>
          <details>
            <summary>Will it work on my website?</summary>
            <p>
              Tholi discovers live controls on ordinary HTTP and HTTPS pages.
              Some dashboards and longer workflows remain unreliable,
              particularly when controls are inaccessible or a future screen is
              unknown. The preview explains missing evidence rather than
              claiming a result.
            </p>
          </details>
          <details>
            <summary>Does it click or handle sign-in for me?</summary>
            <p>
              You click, choose, and authenticate on the website. Tholi can
              scroll a fresh target into view and highlight it. Passwords and
              two-factor codes remain on the website.
            </p>
          </details>
          <details>
            <summary>Where does my information go?</summary>
            <p>
              The default navigation, language processing, and visual assistance
              run locally. Reusable interface knowledge stays in your browser.
              There is no required cloud model, account, or background upload
              service.
            </p>
          </details>
          <details>
            <summary>Is Conversation a cloud chatbot?</summary>
            <p>
              No. It presents actual navigation events and route evidence
              through the local pipeline. General-purpose LLM answers are not
              part of this preview.
            </p>
          </details>
        </div>
      </section>
      <section className="closing">
        <div>
          <p className="eyebrow">A LITTLE HELP, RIGHT THERE</p>
          <h2>
            Your next step,
            <br />
            made clear.
          </h2>
          <p>Start with the Chrome extension. No account needed.</p>
        </div>
        <SiteLink to="/download" className="web-primary">
          Find your way with Tholi <ArrowRight aria-hidden="true" />
        </SiteLink>
      </section>
    </>
  );
}
