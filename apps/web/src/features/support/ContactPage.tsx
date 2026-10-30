import { useEffect, useRef, useState, type FormEvent } from "react";
import { SiteLink, useRouter } from "../../app/router";
import { serviceApiOrigin } from "../../config/project";
import { AccountProvider, useAccount } from "../account/session";
import { legalOperator } from "../legal/operator";
import { serviceCapabilitiesSchema } from "../../../../../packages/navigation-core/contracts-service";
import {
  SUPPORT_LIMITS,
  SUPPORT_TOPICS,
  supportInputSchema,
  supportRequestSchema,
  type SupportRequest,
} from "../../../../../packages/navigation-core/contracts-support";
import { AccountDiagnostic } from "./AccountDiagnostic";
import "./support.css";

type MessageDraft = { subject: string; body: string; copy: string };
type Account = ReturnType<typeof useAccount>;

export function ContactPage() {
  return serviceApiOrigin ? (
    <AccountProvider>
      <ConfiguredContact />
    </AccountProvider>
  ) : (
    <ContactForm />
  );
}
function ConfiguredContact() {
  return <ContactForm account={useAccount()} />;
}
function ContactForm({ account }: { account?: Account }) {
  const { search } = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [receipt, setReceipt] = useState<{
    scope: string;
    value: SupportRequest;
  }>();
  const [capabilities, setCapabilities] = useState<{
    scope: string;
    value: string[];
  }>();
  const submission = useRef<{ body: string; key: string } | undefined>(
    undefined,
  );
  const scope = account?.session
    ? `${account.session.account.id}:${account.session.account.workspaceId}:${account.session.session.id}`
    : "";
  const request = account?.request;
  useEffect(() => {
    let active = true;
    if (scope && request)
      void request("/api/v1/capabilities", serviceCapabilitiesSchema)
        .then((value) => {
          if (active) setCapabilities({ scope, value: value.capabilities });
        })
        .catch(() => {
          if (active) setCapabilities({ scope, value: [] });
        });
    return () => {
      active = false;
    };
  }, [scope, request]);
  const offered = capabilities?.scope === scope ? capabilities.value : [];
  const online = !!scope && offered.includes("support-requests");
  const saved = receipt?.scope === scope ? receipt.value : undefined;
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (draft) draftHeading.current?.focus();
  }, [draft]);
  useEffect(() => {
    if (saved) receiptHeading.current?.focus();
  }, [saved]);

  const prepare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) || "").trim();
    const next: Record<string, string> = {};
    const email = form.elements.namedItem("email") as HTMLInputElement;
    if (!value("email") || !email.validity.valid)
      next.email = "Enter an email address we can reply to.";
    if (!value("subject")) next.subject = "Give your message a short subject.";
    if (!value("message")) next.message = "Tell us what you’d like help with.";
    const values = {
      name: value("name"),
      email: value("email"),
      topic: value("topic"),
      subject: value("subject"),
      message: value("message"),
    };
    const payload = supportInputSchema.safeParse({
      ...values,
      idempotencyKey: "validation",
    });
    if (!payload.success)
      for (const issue of payload.error.issues) {
        const field = String(issue.path[0]);
        next[field] ||= "Check this field and its length.";
      }
    setErrors(next);
    setCopyStatus("");
    setSendError("");
    if (Object.keys(next).length) {
      setDraft(null);
      (form.elements.namedItem(Object.keys(next)[0]) as HTMLElement)?.focus();
      return;
    }
    if (online && account && payload.success) {
      setDraft(null);
      const body = JSON.stringify(values);
      if (submission.current?.body !== body)
        submission.current = { body, key: crypto.randomUUID() };
      setSending(true);
      try {
        const response = await account.request(
          "/api/v1/support/requests",
          supportRequestSchema,
          "POST",
          {
            ...payload.data,
            idempotencyKey: submission.current!.key,
          },
        );
        setReceipt({ scope, value: response });
      } catch (error) {
        setSendError(
          error instanceof Error
            ? error.message
            : "Your request could not be saved. Try again when you are ready.",
        );
      } finally {
        setSending(false);
      }
      return;
    }
    const subject = `[Tholi ${value("topic")}] ${value("subject").replace(/[\r\n]/g, " ")}`;
    const body = [
      `Name: ${value("name") || "Not provided"}`,
      `Reply to: ${value("email")}`,
      `Topic: ${value("topic")}`,
      "",
      value("message"),
    ].join("\n");
    setDraft({
      subject,
      body,
      copy: `To: ${legalOperator.email}\nSubject: ${subject}\n\n${body}`,
    });
  };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.copy);
      setCopyStatus(
        "Message copied. Paste it into an email and send it when you’re ready.",
      );
    } catch {
      setCopyStatus(
        "Copy isn’t available here. Select and copy the prepared message below.",
      );
    }
  };

  return (
    <section className="help-page contact-page">
      <div className="help-heading">
        <p className="eyebrow">CONTACT THOLI</p>
        <h1>We’re listening.</h1>
        <p className="web-intro">
          A question, an idea or a step that didn’t go as planned. Tell us a
          little about it.
        </p>
      </div>
      <div className="contact-layout">
        <div className="contact-form-area">
          <h2>What’s on your mind?</h2>
          <p id="contact-delivery-note" className="contact-delivery-note">
            {online
              ? "Send a request through your Tholi account. It is saved and queued for support, which does not confirm email delivery. Receipts use your verified account email."
              : "Prepare your message here, then send it through your email app. Nothing is sent by this form."}
          </p>
          {account && !scope && !account.loading && (
            <p className="contact-field-hint">
              You can also <SiteLink to="/signin">sign in</SiteLink> to use
              account support when it is available.
            </p>
          )}
          <form
            noValidate
            onSubmit={prepare}
            aria-label="Contact Tholi"
            aria-describedby="contact-delivery-note"
            aria-busy={sending}
            onInput={() => {
              setDraft(null);
              setCopyStatus("");
              setReceipt(undefined);
              setSendError("");
            }}
          >
            <div className="contact-fields-row">
              <div className="contact-field">
                <label htmlFor="contact-name">
                  Name <span>(optional)</span>
                </label>
                <input
                  id="contact-name"
                  name="name"
                  autoComplete="name"
                  maxLength={SUPPORT_LIMITS.name}
                  disabled={sending}
                  aria-invalid={!!errors.name}
                  aria-describedby={
                    errors.name ? "contact-name-error" : undefined
                  }
                />
                {errors.name && (
                  <p
                    id="contact-name-error"
                    className="contact-field-error"
                    role="alert"
                  >
                    {errors.name}
                  </p>
                )}
              </div>
              <div className="contact-field">
                <label htmlFor="contact-email">
                  Email <span>(required)</span>
                </label>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={SUPPORT_LIMITS.email}
                  disabled={sending}
                  aria-invalid={!!errors.email}
                  aria-describedby={
                    errors.email ? "contact-email-error" : undefined
                  }
                />
                {errors.email && (
                  <p
                    className="contact-field-error"
                    id="contact-email-error"
                    role="alert"
                  >
                    {errors.email}
                  </p>
                )}
              </div>
            </div>
            <div className="contact-field">
              <label htmlFor="contact-topic">What’s it about?</label>
              <select
                id="contact-topic"
                name="topic"
                disabled={sending}
                aria-invalid={!!errors.topic}
                aria-describedby={
                  errors.topic ? "contact-topic-error" : undefined
                }
                defaultValue={
                  new URLSearchParams(search).get("topic") === "support"
                    ? "Support"
                    : "Feedback"
                }
              >
                {SUPPORT_TOPICS.map((topic) => (
                  <option key={topic}>{topic}</option>
                ))}
              </select>
              {errors.topic && (
                <p
                  id="contact-topic-error"
                  className="contact-field-error"
                  role="alert"
                >
                  {errors.topic}
                </p>
              )}
            </div>
            <div className="contact-field">
              <label htmlFor="contact-subject">
                Subject <span>(required)</span>
              </label>
              <input
                id="contact-subject"
                name="subject"
                required
                maxLength={SUPPORT_LIMITS.subject}
                disabled={sending}
                aria-invalid={!!errors.subject}
                aria-describedby={
                  errors.subject ? "contact-subject-error" : undefined
                }
              />
              {errors.subject && (
                <p
                  className="contact-field-error"
                  id="contact-subject-error"
                  role="alert"
                >
                  {errors.subject}
                </p>
              )}
            </div>
            <div className="contact-field">
              <label htmlFor="contact-message">
                Message <span>(required)</span>
              </label>
              <textarea
                id="contact-message"
                name="message"
                rows={6}
                maxLength={SUPPORT_LIMITS.message}
                disabled={sending}
                required
                aria-invalid={!!errors.message}
                aria-describedby={`contact-message-hint${errors.message ? " contact-message-error" : ""}`}
              />
              <p id="contact-message-hint" className="contact-field-hint">
                For support, include your browser, Tholi version and the steps
                you tried. Please leave out passwords.
              </p>
              {errors.message && (
                <p
                  className="contact-field-error"
                  id="contact-message-error"
                  role="alert"
                >
                  {errors.message}
                </p>
              )}
            </div>
            <p className="contact-privacy">
              {online
                ? "Your submitted message expires after 30 days. Leave out passwords, page contents and other sensitive information."
                : "Your draft stays on this page until you open your email app or copy it."}{" "}
              <SiteLink to="/privacy">Read our privacy notice</SiteLink>.
            </p>
            <button type="submit" className="web-primary" disabled={sending}>
              {sending
                ? "Saving request…"
                : online
                  ? "Send request"
                  : "Prepare message"}
            </button>
            {sending && (
              <p role="status">
                Saving your request. Please wait before submitting again.
              </p>
            )}
            {sendError && (
              <p className="contact-field-error" role="alert">
                {sendError}
              </p>
            )}
          </form>
          {saved && (
            <section
              className="contact-draft"
              aria-labelledby="contact-saved-title"
            >
              <h2 id="contact-saved-title" tabIndex={-1} ref={receiptHeading}>
                Your request is saved.
              </h2>
              <p role="status">
                Support delivery is queued. This does not confirm that an email
                reached an inbox.
              </p>
              <p>
                Reference: <code>{saved.id}</code>
              </p>
            </section>
          )}
          {account && scope && offered.includes("private-files") && (
            <AccountDiagnostic key={scope} account={account} />
          )}
          {draft && (
            <section
              className="contact-draft"
              aria-labelledby="contact-draft-title"
            >
              <h2 id="contact-draft-title" tabIndex={-1} ref={draftHeading}>
                Your message is ready to email.
              </h2>
              <p>
                Review your draft, then open your email app to send it to us. If
                an app doesn’t open, copy the message and email it to{" "}
                <a href={`mailto:${legalOperator.email}`}>
                  {legalOperator.email}
                </a>
                .
              </p>
              <label htmlFor="contact-prepared-message">Prepared message</label>
              <textarea
                id="contact-prepared-message"
                readOnly
                value={draft.copy}
                rows={8}
              />
              <div className="contact-draft-actions">
                <a
                  className="web-primary"
                  href={`mailto:${legalOperator.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                >
                  Open email draft
                </a>
                <button
                  type="button"
                  className="web-secondary"
                  onClick={() => void copy()}
                >
                  Copy message
                </button>
              </div>
              <p role="status">{copyStatus}</p>
            </section>
          )}
        </div>
        <aside className="contact-aside" aria-label="Other ways to find help">
          <p className="eyebrow">A LITTLE DIRECTION</p>
          <h2>
            Let’s find
            <br />
            the right help.
          </h2>
          <p>
            Need a hand getting set up? Our support page is a good place to
            start.
          </p>
          <SiteLink to="/support" className="web-text-link">
            Visit Tholi support
          </SiteLink>
          <div className="contact-address">
            <span className="eyebrow">PREFER EMAIL?</span>
            <a href={`mailto:${legalOperator.email}`}>{legalOperator.email}</a>
            <p>Tholi is made by {legalOperator.name}.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
