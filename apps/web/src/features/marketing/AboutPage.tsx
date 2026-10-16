import "./marketing.css";
import { SiteLink } from "../../app/router";
import { WayfinderStage } from "./WayfinderStage";
export function AboutPage() {
  return (
    <section className="reading about-page">
      <div className="about-hero">
        <div>
          <p className="eyebrow">MEET THOLI</p>
          <h1>
            A patient guide
            <br />
            beside you.
          </h1>
          <p className="web-intro">
            The web has a lot of doors. Tholi helps you find the one you came
            for, while leaving the mouse in your hands.
          </p>
          <p className="about-hero-note">
            The amber point in our wordmark is a small companion with a purpose.
            It waits, finds a path, asks for a moment and acknowledges arrival.
          </p>
        </div>
        <WayfinderStage />
      </div>
      <div className="about-story" data-reveal="heading">
        <span>THE NAME</span>
        <div>
          <h2>Inspired by umtholi.</h2>
          <p>
            Tholi’s name draws on the idea of finding your way. A little
            direction at the right moment can make unfamiliar software feel more
            familiar, without turning every task into another thing to learn.
          </p>
        </div>
      </div>
      <div className="about-principles">
        <div>
          <span className="eyebrow">CLARITY</span>
          <h3>One useful next step.</h3>
          <p>
            A readable instruction, a grounded highlight and room to change your
            mind. The interface should help you move, not ask you to manage it.
          </p>
        </div>
        <div>
          <span className="eyebrow">CONTINUITY</span>
          <h3>Keep the destination.</h3>
          <p>
            A menu opening is rarely the whole task. Tholi keeps the objective
            through changing screens and checks for the requested outcome.
          </p>
        </div>
        <div>
          <span className="eyebrow">AGENCY</span>
          <h3>Your actions stay yours.</h3>
          <p>
            You choose, click and authenticate. Processing is local by default,
            and consequential website actions stay under your control.
          </p>
        </div>
      </div>
      <div className="about-story">
        <span>THE WORK IN PROGRESS</span>
        <div>
          <h2>Capable. Honest. Still learning.</h2>
          <p>
            This is a working preview. Complex dashboards and signed-in journeys
            still need more real-site verification. When evidence is missing, a
            task stays incomplete. A polished interface cannot make an uncertain
            route reliable.
          </p>
          <SiteLink to="/docs" className="web-text-link">
            Understand the current experience
          </SiteLink>
        </div>
      </div>
      <div className="about-ownership">
        <div>
          <p className="eyebrow">MADE BY ILUNỌNSEN</p>
          <h2>
            A little direction,
            <br />
            made with care.
          </h2>
          <p>
            Tholi is operated by{" "}
            <a href="https://ilunonsen.com">ILUNỌNSEN LLC</a>, in Ohio, United
            States. Questions or feedback? Reach us at{" "}
            <a href="mailto:info@ilunonsen.com">info@ilunonsen.com</a>.
          </p>
        </div>
        <SiteLink to="/download" className="web-primary">
          Try the extension preview
        </SiteLink>
      </div>
    </section>
  );
}
