import { useEffect, useRef, useState, type FormEvent } from "react";
import { SiteLink, useRouter } from "../../app/router";
import { legalOperator } from "../legal/operator";
import "./support.css";

const topics = ["Support", "Feedback", "Partnerships", "Something else"];
type MessageDraft = { subject: string; body: string; copy: string };

export function ContactPage() {
  const { search } = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (draft) draftHeading.current?.focus();
  }, [draft]);

  const prepare = (event: FormEvent<HTMLFormElement>) => {
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
    setErrors(next);
    setCopyStatus("");
    if (Object.keys(next).length) {
      setDraft(null);
      (form.elements.namedItem(Object.keys(next)[0]) as HTMLElement)?.focus();
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
            Direct form delivery is coming soon. For now, prepare your message
            here, then send it through your email app. Nothing is sent by this
            form.
          </p>
          <form
            noValidate
            onSubmit={prepare}
            aria-label="Contact Tholi"
            aria-describedby="contact-delivery-note"
            onInput={() => {
              setDraft(null);
              setCopyStatus("");
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
                  maxLength={80}
                />
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
                  maxLength={254}
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
                defaultValue={
                  new URLSearchParams(search).get("topic") === "support"
                    ? "Support"
                    : "Feedback"
                }
              >
                {topics.map((topic) => (
                  <option key={topic}>{topic}</option>
                ))}
              </select>
            </div>
            <div className="contact-field">
              <label htmlFor="contact-subject">
                Subject <span>(required)</span>
              </label>
              <input
                id="contact-subject"
                name="subject"
                required
                maxLength={120}
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
                maxLength={3000}
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
              Your draft stays on this page until you open your email app or
              copy it.{" "}
              <SiteLink to="/privacy">Read our privacy notice</SiteLink>.
            </p>
            <button type="submit" className="web-primary">
              Prepare message
            </button>
          </form>
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
