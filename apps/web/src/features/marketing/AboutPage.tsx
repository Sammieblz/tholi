import "./marketing.css";
import { SiteLink } from "../../app/router";

export function AboutPage() {
  return (
    <section className="reading">
      <p className="eyebrow">MEET THOLI</p>
      <h1>
        A patient guide
        <br />
        beside you.
      </h1>
      <p>
        Tholi helps you find the next step through unfamiliar software, rather
        than taking control of it.
      </p>
      <h2>Inspired by umtholi.</h2>
      <p>
        The name comes from the founder’s naming brief. The shortened name
        expresses the idea of finding your way.
      </p>
      <h2>Capable, and honest.</h2>
      <p>
        Tholi searches what it can observe and checks outcomes. It can still
        miss controls or lack a route. The current product is a preview, with
        signed-in workflow verification still in progress.
      </p>
      <h2>Your browser remains yours.</h2>
      <p>
        Reusable interface knowledge stays local. Form values and screenshots
        are not stored. Authentication remains on the website. This demo website
        has no analytics or real account service.
      </p>
      <SiteLink to="/download" className="web-primary">
        Try the extension preview
      </SiteLink>
    </section>
  );
}
