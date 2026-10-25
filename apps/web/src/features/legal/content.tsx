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
            This notice covers the public Tholi website and browser extension.
            Tholi uses page context to guide you toward a destination you
            request and verify your progress. Normal guidance runs on your
            device without a Tholi account or backend. Connecting a private
            backend is optional and changes where some data is processed, as
            explained below. Other websites, including the operator’s corporate
            site, have their own privacy practices.
          </p>
        </>
      ),
    },
    {
      id: "website",
      title: "The public website",
      children: (
        <>
          <p>
            You can read the documentation, download the extension and try the
            practice without a Tholi account or optional cookies. Product
            recordings, screenshots, fonts and practice assets are served with
            this website. The practice is a controlled local demonstration,
            rather than a connection to your installed extension.
          </p>
          <p>
            The public website has no sign-up, sign-in or account management
            service. Installation and optional practice do not create a Tholi
            account or store your name, email, password or onboarding progress.
            Contact drafts are handled separately as described below.
          </p>
          <p>
            On tholi.io, Cloudflare adds page-view and performance measurements
            independently of the website’s cookie choices. The app’s own
            optional analytics provider remains inactive, and there is no
            advertising integration. Cookie choices govern Tholi’s appearance
            storage; they do not disable Cloudflare’s injected script. See the{" "}
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
            Opening the panel alone does not start page discovery. When you
            start guidance or page exploration on an authorized website, Tholi
            reads bounded control labels, accessible names, headings, roles,
            form metadata, relationships, availability and geometry. It does not
            read input or textarea values, passwords, one-time codes or editable
            contents. Labels themselves may still contain personal information;
            automatic redaction cannot identify every private label.
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
          <p>
            Task context includes your destination, details you supply,
            task-related website addresses and navigation transitions, and
            relevant interface interactions. Requests, labels and visible page
            content can contain names, usernames, communications, locations,
            health information or financial information. Tholi does not reliably
            identify or exclude every sensitive category. Do not put passwords,
            payment credentials or other secrets into a destination or message.
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
            journeys, composer draft and up to 80 conversation messages are
            stored in trusted extension browser-session storage. They are not
            synchronized with this website or a cloud account. Relevant task
            text and session context may nevertheless be sent to a backend you
            explicitly connect; session-only storage is a retention limit, not a
            guarantee that information never leaves your device. Session data is
            cleared when the browser session ends.
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
          <p>
            Appearance, guidance preferences, widget bounds and configured
            backend settings use separate persistent extension storage. They can
            outlast a browser session. Expiration of learned knowledge is
            applied when records are accessed; it is not a promise of scheduled
            deletion from a closed browser or an independent server’s backups.
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
          <p>
            A capture can still contain sensitive information displayed outside
            editable fields. Masking does not guarantee removal of all personal,
            health, financial or communication content. Captures are processed
            locally by default; enabling backend OCR sends masked images to the
            backend you configure.
          </p>
        </>
      ),
    },
    {
      id: "local-models",
      title: "Local models and optional browser AI",
      children: (
        <>
          <p>
            The default language model, OCR workers and executable model
            runtimes are bundled with the extension. Normal guidance does not
            require a hosted model API. If you separately enable Chrome’s
            built-in language model option, Chrome may download its model. That
            option processes bounded, sanitized observations and task context
            through Chrome’s local Prompt API. Model suggestions remain subject
            to Tholi’s verification and action boundaries.
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
            Backend access is disabled by default. If you explicitly connect
            one, requests can include your task text, supplied task details,
            website origins and routes, bounded page observations, navigation
            context and reusable website knowledge. These requests support
            planning, suggestions and knowledge mirroring. The supplied API
            processes private session context in memory and persists reusable
            knowledge under the same parameterized-route policy. Backend OCR
            sends temporary masked captures only when you enable it. The
            supplied service does not persist OCR payloads or private session
            context in payload logs.
          </p>
          <p>
            You control the backend deployment, host and access credentials. A
            remote server’s infrastructure and logging depend on its operator.
            Review that environment before connecting; this notice cannot
            describe an independent operator’s practices.{" "}
            <SiteLink to="/docs/backend">Backend setup</SiteLink> explains the
            trust boundary.
          </p>
          <p>
            Backend URLs must use HTTPS, except that HTTP is allowed for a
            service on your own computer’s loopback address. A remote backend
            and its infrastructure may receive connection metadata such as your
            IP address in addition to request content. Their logging, retention
            and processing location depend on that deployment.
          </p>
        </>
      ),
    },
    {
      id: "backend-credentials",
      title: "Backend credentials and permission choices",
      children: (
        <>
          <p>
            Connecting a backend stores its address, enabled state and API
            bearer token in extension-controlled persistent storage: protected
            local storage on Chromium, or extension-origin IndexedDB on Firefox.
            Website scripts and Tholi’s page widget are not given the token.
            Requests to the configured backend send it in an Authorization
            header. This is separate from website passwords, which page
            discovery does not read. Browser access controls protect these
            settings; Tholi does not add its own encryption at rest.
          </p>
          <p>
            Firefox also requests optional browser consent for backend
            transmission of authentication information, browsing activity,
            website activity and website content. Declining that consent keeps
            local processing available. Disabling the backend or revoking its
            applicable browser permissions prevents subsequent authorized
            requests; it does not erase saved credentials or copies already
            received by the server. To clear the saved token, disable Connect
            this browser, empty the API token field and select Save connection.
            Rotate the token at your backend if access should be invalidated.
          </p>
        </>
      ),
    },
    {
      id: "limited-use",
      title: "How we limit use and sharing",
      children: (
        <>
          <p>
            Tholi’s use of information received through Chrome APIs adheres to
            the{" "}
            <a href="https://developer.chrome.com/docs/webstore/program-policies/limited-use">
              Chrome Web Store User Data Policy, including Limited Use
            </a>
            . We use extension data to provide and improve its disclosed
            website-guidance functionality. We do not sell it, use it for
            personalized advertising, or use or transfer it for creditworthiness
            or lending decisions.
          </p>
          <p>
            Transfers are limited to providing that functionality, complying
            with law, protecting against abuse, or a business transfer with
            explicit prior consent. Human access requires your explicit consent
            to specific data, a security or legal need, or aggregated,
            anonymized data for permitted internal operations. Ordinary local
            guidance does not upload observations to us for staff review.
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
            Pause retains the destination and stops page observation and
            guidance. Stop cancels the active guidance task and observation.
            Minimizing the widget can keep authorized observation active;
            closing or hiding a surface is not deletion. Use Pause or Stop when
            you want observation to end. Reset current session clears unfinished
            journeys, draft and conversation. Separate Forget and Clear controls
            remove learned website knowledge and saved routes. Uninstalling
            removes extension-owned local data.
          </p>
          <p>
            If a connected backend is offline during deletion, Tholi reports the
            failed mirror deletion so you can reconnect and retry. Website
            cookie settings can remove the stored appearance preference. Browser
            site-data controls can clear website session storage and cookies
            independently from the extension.
          </p>
          <p>
            Local deletion or uninstalling does not itself erase a backend’s
            database, infrastructure logs or backups. Complete remote deletion
            while connected where supported, and contact the backend operator
            about any other retained copies. Disabling a connection alone does
            not send a deletion request.
          </p>
          <p>
            For questions, access, correction or deletion requests, email{" "}
            <Contact />. Include only what is needed to explain your request. We
            cannot retrieve or erase device-only extension data remotely.
            Applicable privacy rights depend on your location and the processing
            involved; using Tholi does not require you to waive them. Where
            applicable, you may also raise a concern with your privacy
            regulator.
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
            This website has no production account service, hosted inference or
            advertising integration. The optional extension backend described
            above is a separate connection you configure. Links to GitHub and
            other websites leave Tholi and are governed by those services.
            Browser stores also process installation and store account
            information under their own policies.
          </p>
          <p>
            Cloudflare Pages hosts tholi.io and delivers its assets. Cloudflare
            processes connection and request information, including IP addresses
            and traffic metadata, to deliver and protect the website. Its
            processing, retention and international transfers are described in{" "}
            <a href="https://www.cloudflare.com/privacypolicy/">
              Cloudflare’s privacy policy
            </a>
            . This notice does not promise a specific hosting-log retention
            period or processing country.
          </p>
          <p>
            The contact form prepares a draft in page memory; it does not submit
            your message to a Tholi server or save it in browser storage.
            Opening an email draft passes its contents to your email app;
            copying uses your device’s clipboard. Contacting us by email shares
            the message with the company’s email service. We use correspondence
            to respond to your request and retain it as needed for that request
            and applicable obligations; do not send passwords or private
            browsing captures.
          </p>
          <p>
            The date shown above identifies this notice’s latest update;
            professional legal review remains pending. We will revise this
            notice when actual product behavior changes. Material optional
            processing will not be enabled by silently reusing an earlier cookie
            choice.
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
      title: "About Tholi",
      children: (
        <>
          <p>
            These terms describe the public Tholi website and extension offered
            by {legalOperator.name}, {legalOperator.location}. They are
            published with the website; professional legal review remains
            pending. Tholi provides contextual website guidance; it does not act
            as the website or account provider. Contact <Contact /> with
            questions.
          </p>
          <p>
            Tholi is distributed through the Chrome Web Store and Firefox
            Add-ons, subject to each store’s own terms. Installing the extension
            does not authorize a private backend connection, purchases or future
            paid services. The permissions you grant and features you enable
            control access as described in the privacy notice.
          </p>
          <p>
            The website and local extension require no Tholi account. The
            website does not offer registration, paid subscriptions, cloud
            synchronization or an authentication service.
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
            your intention. Guide mode leaves website interactions with you.
            Optional assisted navigation can open eligible menus and select
            explicitly requested view options. It does not enter credentials,
            submit forms or perform final actions. You handle authentication,
            purchases, plan changes, deployments and cancellations.
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
            Tholi is provided without a promise of uninterrupted availability, a
            particular route, error-free results or suitability for a particular
            purpose. The MIT License supplies the software’s applicable warranty
            and liability language. Nothing here removes rights or remedies that
            applicable law does not allow us to exclude.
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
            your choice and require a separately configured service. Cloudflare
            hosts the website and provides the page/performance measurements
            described in those notices.
          </p>
          <p>
            Future paid services, real accounts or cloud inference would need
            their own accurate terms and disclosures before activation.
          </p>
          <p>
            If you connect a backend, choose an operator you trust, protect its
            access token and review its hosting, retention and security
            practices. A remote connection can transmit task details and page
            context; enabling backend OCR can also transmit masked captures. An
            independent operator’s additional terms may apply. Disabling a
            connection does not delete data already received by that operator.
          </p>
        </>
      ),
    },
    {
      id: "ending-use",
      title: "Stopping use and product changes",
      children: (
        <>
          <p>
            You can stop using Tholi at any time. Pause or stop guidance,
            disable optional connections, remove browser permissions or
            uninstall the extension. Use its separate deletion controls to
            remove saved knowledge and session context. Uninstalling cannot
            erase data already held by a backend or another website.
          </p>
          <p>
            Features and compatibility may change as Tholi and third-party
            websites evolve. We will update these documents when the service
            changes; new optional processing requires the relevant choice or
            consent before activation. Future terms for hosted or paid services
            do not narrow rights already granted under the MIT License.
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
            Send questions or reports to <Contact />. The website is public;
            professional review of the service description, dispute provisions,
            hosting disclosures and effective terms remains pending.
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
      title: "Cloudflare measurements and optional analytics",
      children: (
        <>
          <p>
            On tholi.io, Cloudflare injects a measurement script that reports
            page views and page-load performance. The script loads from
            static.cloudflareinsights.com and sends measurements to
            /cdn-cgi/rum. These host-level measurements run independently of
            Tholi’s cookie choices; choosing Essential only does not disable
            them. See{" "}
            <a href="https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/">
              Cloudflare’s data collection documentation
            </a>
            .
          </p>
          <p>
            The app’s own optional analytics provider is inactive. Its consent
            gate applies to a future provider added by Tholi. It cannot activate
            collection without that provider’s identity and disclosures plus
            fresh provider-specific consent. Eligible future events are limited
            to page views, download clicks and practice start or completion.
            Destination text, conversations, account details, documentation
            searches and extension observations are excluded.
          </p>
          <p>
            For that future app provider, withdrawing consent stops optional
            events and clears pending work. Its identity and retention period
            will be listed here before activation. This gate does not control
            scripts added by the hosting platform.
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
            The public website does not use account sessions or store account
            details. Earlier website demonstrations may have left a{" "}
            <code>tholi-demo-account</code> entry in browser-session storage.
            This version does not read or write it. You can remove that legacy
            entry with your browser’s site-data controls; session restoration
            can affect when the browser clears it automatically.
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
