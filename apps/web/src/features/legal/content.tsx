import type { ReactNode } from "react";
import { SiteLink } from "../../app/router";
import { repositoryUrl } from "../../config/project";
import { legalOperator } from "./operator";
export type LegalPageName = "privacy" | "terms" | "cookies";
type LegalSection = { id: string; title: string; children: ReactNode };
const Contact = () => (
  <a href={`mailto:${legalOperator.email}`}>{legalOperator.email}</a>
);
const SourcePrivacy = () => (
  <a href={`${repositoryUrl}/blob/main/docs/architecture/privacy.md`}>
    extension privacy reference
  </a>
);
export function privacySections(): LegalSection[] {
  return [
    {
      id: "who-we-are",
      title: "Who operates Tholi",
      children: (
        <>
          <p>
            Tholi is operated by {legalOperator.name} in{" "}
            {legalOperator.location}. For privacy questions or requests, contact{" "}
            <Contact />. The company website is{" "}
            <a href={legalOperator.companyUrl}>ilunonsen.com</a>.
          </p>
          <p>
            This notice describes the local website preview and the Tholi
            extension. Other websites you visit have their own privacy
            practices. The operator’s corporate-site policy applies separately
            to that site.
          </p>
        </>
      ),
    },
    {
      id: "website",
      title: "The website preview",
      children: (
        <>
          <p>
            You can read the documentation, download the extension and try the
            practice without an account or optional cookies. Product recordings,
            screenshots, fonts and practice assets are served with this website.
            The practice is a controlled local demonstration, rather than a
            connection to your installed extension.
          </p>
          <p>
            Sign-up and sign-in are visibly mocked. If you use them, your
            supplied name, email and onboarding progress stay in this website’s
            browser-session storage. Passwords are validated locally, never
            stored and never sent to an account service. Sign-out removes the
            mock account. Closing the browser session normally ends this
            storage; a browser’s session-restore behavior can vary. You can also
            clear it using your browser’s site-data controls.
          </p>
          <p>
            There is no production analytics provider configured and no
            analytics or advertising collection in this preview. Optional
            analytics will require a named provider, updated disclosures and
            fresh consent before activation. Cookie choices govern actual
            storage, as explained in the{" "}
            <SiteLink to="/cookies">cookie notice</SiteLink>.
          </p>
        </>
      ),
    },
    {
      id: "extension-observation",
      title: "What the extension observes",
      children: (
        <>
          <p>
            When you start guidance or page exploration on an authorized
            website, Tholi reads bounded control labels, accessible names,
            headings, roles, form metadata, relationships, availability and
            geometry. It does not read input or textarea values, passwords,
            one-time codes or editable contents. Labels themselves may still
            contain personal information; automatic redaction cannot identify
            every private label.
          </p>
          <p>
            Guide mode leaves website interaction with you. Optional assisted
            navigation can open eligible menus and select explicitly requested
            view options; it does not enter credentials, submit forms or perform
            final actions. You can disable it or pause guidance. A task-scoped
            navigation ledger supports continuity and return routes while Tholi
            is active. It is not a general browsing-history collection service.
            Restricted browser pages and unpermitted origins cannot be
            inspected.
          </p>
        </>
      ),
    },
    {
      id: "extension-storage",
      title: "Session context and learned knowledge",
      children: (
        <>
          <p>
            Your destination, supplied parameters, entity bindings, unfinished
            journeys, composer draft and bounded conversation history remain in
            trusted extension browser-session storage. They are not synchronized
            with this website or a cloud account. A private session ends with
            the browser session.
          </p>
          <p>
            Reusable, sanitized interface semantics and parameterized routes are
            saved in extension-owned IndexedDB. Private supplied values and
            private entity embeddings remain session-only. Saved routes request
            their private parameters again. Knowledge has bounded record counts
            and expires after 90 days when accessed. Screenshots, raw HTML,
            private OCR text, field values and image coordinates are not saved
            as route knowledge. See the <SourcePrivacy /> for the exact current
            limits.
          </p>
        </>
      ),
    },
    {
      id: "ocr",
      title: "Temporary visual processing",
      children: (
        <>
          <p>
            When normal discovery lacks reliable evidence and capture access is
            available, OCR can process the active authorized viewport. Tholi
            hides its own surfaces and masks discovered editable fields and
            iframe rectangles. Images and recognized private text are temporary
            in-memory processing data. OCR text alone cannot establish task
            completion.
          </p>
          <p>
            Masking and recognition have limitations, especially on unusual or
            opaque interfaces. Avoid starting capture around sensitive content
            you do not want processed. Default local models run on your device;
            experimental engines are identified separately.
          </p>
        </>
      ),
    },
    {
      id: "backend",
      title: "An optional backend you connect",
      children: (
        <>
          <p>
            No backend is required. If you explicitly connect one, it may
            process bounded observations and private session context in memory.
            The supplied API persists reusable knowledge under the same
            parameterized-route policy. Backend OCR sends temporary masked
            captures only when you enable it. The supplied service does not
            persist OCR payloads or private session context in payload logs.
          </p>
          <p>
            You control the backend deployment, host and access credentials. A
            remote server’s infrastructure and logging depend on its operator.
            Review that environment before connecting; this notice cannot
            describe an independent operator’s practices.{" "}
            <SiteLink to="/docs/backend">Backend setup</SiteLink> explains the
            trust boundary.
          </p>
        </>
      ),
    },
    {
      id: "your-controls",
      title: "Your controls and deletion",
      children: (
        <>
          <p>
            Pause retains the destination. Stop cancels navigation. Closing or
            hiding the widget retains the current session; it is not deletion.
            Reset current session clears unfinished journeys, draft and
            conversation. Separate Forget and Clear controls remove learned
            website knowledge and saved routes. Uninstalling removes
            extension-owned local data.
          </p>
          <p>
            If a connected backend is offline during deletion, Tholi reports the
            failed mirror deletion so you can reconnect and retry. Website
            cookie settings can remove the stored appearance preference. Browser
            site-data controls can clear website session storage and cookies
            independently from the extension.
          </p>
          <p>
            For questions, access or deletion requests, email <Contact />.
            Include only what is needed to explain your request. We cannot
            retrieve or erase device-only extension data remotely. Applicable
            privacy rights depend on your location and the processing involved;
            this preview does not require you to waive them.
          </p>
        </>
      ),
    },
    {
      id: "sharing-and-launch",
      title: "Sharing, hosting and future changes",
      children: (
        <>
          <p>
            This local preview has no account backend, hosted inference,
            background upload service or advertising integration. It does not
            sell or share extension observations for advertising. Links to
            GitHub and other websites leave Tholi and are governed by those
            services.
          </p>
          <p>
            A production host and analytics provider have not been selected for
            this build. Their request metadata, retention, recipients and
            international processing must be disclosed before public launch.
            Contacting us by email necessarily shares the message with the
            company’s email service; do not send passwords or private browsing
            captures.
          </p>
          <p>
            We will revise this notice when actual product behavior changes.
            Material optional processing will not be enabled by silently reusing
            an earlier cookie choice.
          </p>
        </>
      ),
    },
  ];
}
export function termsSections(): LegalSection[] {
  return [
    {
      id: "scope",
      title: "About this preview",
      children: (
        <>
          <p>
            These draft terms describe the Tholi website preview and extension
            offered by {legalOperator.name}, {legalOperator.location}. They are
            prepared for launch review and do not represent a completed
            public-service agreement. Contact <Contact /> with questions.
          </p>
          <p>
            The website, download and extension require no account. Website
            account screens are demonstrations, with no real registration, paid
            subscription, synchronization or authentication service.
          </p>
        </>
      ),
    },
    {
      id: "guidance",
      title: "Guidance and your decisions",
      children: (
        <>
          <p>
            Tholi helps identify a next step from observed interfaces. You
            remain responsible for deciding whether a suggested action matches
            your intention and for performing website interactions,
            authentication, purchases, plan changes, deployments and
            cancellations.
          </p>
          <p>
            Guidance can be incomplete or wrong when interfaces change,
            permissions are missing or evidence is unavailable. A successful
            demonstration, fixture test or interface improvement does not
            promise reliable navigation on every website. Consequential actions
            receive review boundaries, and the extension requires fresh
            task-specific evidence before declaring arrival.
          </p>
          <p>
            Do not rely on Tholi as the sole confirmation of a payment,
            cancellation, deployment or other consequential result. Check the
            website’s actual status and any applicable confirmation.
          </p>
        </>
      ),
    },
    {
      id: "use",
      title: "Use and website permissions",
      children: (
        <>
          <p>
            Use Tholi only with websites and accounts you are entitled to
            access, in accordance with their terms and applicable law. Do not
            use it to evade access controls, collect credentials or interfere
            with another person’s service. Tholi does not grant rights to
            third-party content or accounts.
          </p>
          <p>
            Your browser controls extension permissions and capture access. Some
            pages, frames and native controls are inaccessible. You can decline
            access, pause or stop guidance, remove stored knowledge or uninstall
            the extension.
          </p>
        </>
      ),
    },
    {
      id: "license",
      title: "Open-source software and brand assets",
      children: (
        <>
          <p>
            The repository’s software is licensed under the{" "}
            <a href={`${repositoryUrl}/blob/main/LICENSE`}>MIT License</a>,
            including its permission notice, conditions and warranty disclaimer.
            These website terms do not replace or narrow rights granted by that
            license. Dependencies retain their respective licenses and notices.
          </p>
          <p>
            Tholi’s name, supplied wordmark and other brand identifiers are not
            granted as trademarks by the software license. Third-party names and
            captured interfaces identify their respective services and do not
            imply partnership or endorsement.
          </p>
        </>
      ),
    },
    {
      id: "availability",
      title: "Availability and limitations",
      children: (
        <>
          <p>
            This is a preview, provided without a promise of uninterrupted
            availability, a particular route, error-free results or suitability
            for a particular purpose. The MIT License supplies the software’s
            applicable warranty and liability language. Nothing here removes
            rights or remedies that applicable law does not allow us to exclude.
          </p>
          <p>
            Downloads are labeled with their actual packaged version and
            checksum. Source changes may be newer than an eligible archive. A
            local build and a historical validation report can describe
            different bytes.
          </p>
        </>
      ),
    },
    {
      id: "privacy",
      title: "Privacy and optional services",
      children: (
        <>
          <p>
            The <SiteLink to="/privacy">privacy notice</SiteLink> and{" "}
            <SiteLink to="/cookies">cookie notice</SiteLink> explain current
            data handling and your controls. Optional backend connections are
            your choice and require a separately configured service. No
            production analytics provider is active in this preview.
          </p>
          <p>
            Future paid services, real accounts, hosting or cloud inference
            would need their own accurate terms and disclosures before
            activation.
          </p>
        </>
      ),
    },
    {
      id: "governing-law",
      title: "Governing law and contact",
      children: (
        <>
          <p>
            For the launch draft, Ohio law and applicable United States federal
            law are the proposed governing law, subject to mandatory protections
            that may apply where you live. No arbitration requirement,
            class-action waiver or exclusive court venue is introduced by this
            draft.
          </p>
          <p>
            Send questions or reports to <Contact />. Before public launch, the
            operator will review the final service description, dispute
            provisions, hosting disclosures and effective terms.
          </p>
        </>
      ),
    },
  ];
}
export function cookieSections(onCookieSettings?: () => void): LegalSection[] {
  return [
    {
      id: "choices",
      title: "A choice that changes actual storage",
      children: (
        <>
          <p>
            This website uses a necessary cookie to remember your consent
            decision and an optional cookie to remember Light or Dark
            appearance. Reading, downloading and practicing work without
            optional storage. Closing the notice or continuing to browse does
            not grant consent.
          </p>
          <p>
            <strong>Essential only</strong> declines optional storage.{" "}
            <strong>Allow preferences</strong> permits the appearance cookie.{" "}
            <strong>Settings</strong> lets you review the same choices. You can
            reopen Cookie settings from every page’s footer.
          </p>
          {onCookieSettings && (
            <button
              type="button"
              className="web-secondary"
              onClick={onCookieSettings}
            >
              Cookie settings
            </button>
          )}
        </>
      ),
    },
    {
      id: "cookie-inventory",
      title: "Cookies in this build",
      children: (
        <>
          <div className="legal-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Cookie</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Lifetime</th>
                  <th scope="col">Choice</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <code>tholi_consent</code>
                  </th>
                  <td>
                    A versioned record of the choices you make. Contains no
                    account credentials or navigation destination.
                  </td>
                  <td>180 days from a saved choice.</td>
                  <td>Necessary choice record.</td>
                </tr>
                <tr>
                  <th scope="row">
                    <code>tholi_theme</code>
                  </th>
                  <td>Your selected Light or Dark website appearance.</td>
                  <td>
                    Up to 180 days; removed when preference storage is
                    withdrawn.
                  </td>
                  <td>Only after preferences are allowed.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Both cookies are first-party and host-only, use <code>Path=/</code>{" "}
            and <code>SameSite=Lax</code>, and are marked <code>Secure</code> on
            HTTPS. The HTTP localhost preview cannot use a Secure-only cookie.
            These cookies are readable by the website; they are not
            authentication tokens.
          </p>
        </>
      ),
    },
    {
      id: "theme",
      title: "Appearance without optional storage",
      children: (
        <>
          <p>
            The website starts in Dark appearance. If you allow preference
            storage, your selected appearance can be restored on a later visit
            before the page paints. If you decline preferences, your choice
            works in memory for the current page session and is not written to a
            theme cookie.
          </p>
          <p>
            Withdrawing preferences deletes the appearance cookie and stops
            future preference writes. If your browser blocks cookies entirely,
            controls still work for the open page, but the site cannot remember
            your choice after a reload.
          </p>
        </>
      ),
    },
    {
      id: "analytics",
      title: "Analytics is inactive",
      children: (
        <>
          <p>
            No production analytics provider is configured. No analytics scripts
            or events are sent by this preview, and the settings do not offer an
            inactive pretend analytics switch.
          </p>
          <p>
            The software contains a consent gate for a future provider. It
            cannot activate collection without that provider’s identity and
            disclosures plus fresh provider-specific consent. Eligible future
            events are limited to page views, download clicks and practice start
            or completion. Destination text, conversations, account details,
            documentation searches and extension observations are excluded.
          </p>
          <p>
            Withdrawing consent stops future optional events and clears pending
            work. A future provider and retention period will be listed here
            before activation.
          </p>
        </>
      ),
    },
    {
      id: "other-storage",
      title: "Other browser storage",
      children: (
        <>
          <p>
            When you choose to try mock account screens, browser-session storage
            keeps your supplied name, email and onboarding state. It does not
            keep passwords, and there is no real account or credential
            transmission. Sign-out clears the mock account.
          </p>
          <p>
            The extension has its own local and session stores, separate from
            website cookies. Cookie settings do not erase extension knowledge or
            journeys. Use the extension’s Reset current session, Forget and
            Clear controls for those purposes. See the{" "}
            <SiteLink to="/privacy">privacy notice</SiteLink>.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "Questions and changes",
      children: (
        <>
          <p>
            This notice is maintained by {legalOperator.name} in{" "}
            {legalOperator.location}. Contact <Contact />. If the purpose or
            provider changes, we will update the notice and request a new choice
            where needed.
          </p>
          <p>
            The controls follow the principle that choices must govern actual
            storage and processing. See the{" "}
            <a href="https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/how-do-we-manage-consent-in-practice/">
              ICO’s practical consent guidance
            </a>
            . This implementation is not a claim of certified compliance in
            every jurisdiction.
          </p>
        </>
      ),
    },
  ];
}
