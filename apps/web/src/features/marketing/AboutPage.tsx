import "./marketing.css";
import { ArrowRight } from "iconoir-react";
import { SiteLink } from "../../app/router";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
export function AboutPage() {
  return (
    <section className="reading">
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
            for, without taking the mouse out of your hands.
          </p>
        </div>
        <div className="about-mark" aria-hidden="true">
          <Wayfinder state="idle" />
        </div>
      </div>
      <div className="about-story">
        <span>01 / THE NAME</span>
        <div>
          <h2>Inspired by umtholi.</h2>
          <p>
            Tholi’s name is inspired by the idea of finding your way. That idea
            shapes the product: a little direction at the moment you need it,
            and the space to move at your own pace.
          </p>
          <p>
            The amber point in our mark is a companion to that journey. It
            waits, follows a route, and acknowledges a verified arrival. Its
            movement carries meaning instead of asking for your attention
            without a reason.
          </p>
        </div>
      </div>
      <div className="about-story">
        <span>02 / THE EXPERIENCE</span>
        <div>
          <h2>
            Less searching.
            <br />
            More knowing where to go.
          </h2>
          <p>
            You describe a destination. Tholi observes the available interface,
            highlights a grounded next step, and carries the request across
            screens. Guide mode stays concise. Conversation keeps the request
            and its context together.
          </p>
          <p>
            When a route is unclear, Tholi says so. This is a working preview,
            and complex signed-in workflows still need more real-site
            verification. A calmer interface does not change those limitations.
          </p>
        </div>
      </div>
      <div className="about-story">
        <span>03 / YOUR CONTROL</span>
        <div>
          <h2>Your browser remains yours.</h2>
          <p>
            The default experience processes requests locally. Reusable
            interface knowledge stays on your device. Screenshots and form
            values are not saved as route knowledge, and authentication happens
            on the website.
          </p>
          <p>
            You make the website changes. Tholi checks for the requested result.
            This preview website has mock accounts, no analytics, and no real
            account service.
          </p>
        </div>
      </div>
      <SiteLink to="/download" className="web-primary">
        Try the extension preview <ArrowRight aria-hidden="true" />
      </SiteLink>
    </section>
  );
}
