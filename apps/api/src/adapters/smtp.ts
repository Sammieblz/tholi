import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createTransport } from "nodemailer";
import { renderSupportMail } from "../application/support-mail";
import type { MailPort, SmtpOptions } from "../application/support-contracts";
import { validateSmtpOptions } from "../config";

/** Nodemailer owns SMTP. Dedicated sockets provide actual cancellation, not just a timed-out await. */
export function createSmtpMailer(
  input: SmtpOptions,
  allowLocal = false,
): MailPort {
  const options = validateSmtpOptions(input, allowLocal);
  const sockets = new Set<Socket>();
  let closed = false;
  return {
    async send(raw, signal) {
      const rendered = renderSupportMail(raw);
      if (closed || signal.aborted) return "not-sent";
      const command = rendered.command;
      const recipient =
        command.template === "support.operator"
          ? options.supportRecipient
          : command.recipient;
      const active = AbortSignal.any([
        signal,
        AbortSignal.timeout(options.timeoutMs),
      ]);
      let socket: Socket | undefined;
      let connected = false;
      const abort = () => socket?.destroy(new Error("SMTP operation stopped."));
      active.addEventListener("abort", abort, { once: true });
      const transport = createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        requireTLS: options.requireTLS,
        ignoreTLS: options.localCapture,
        opportunisticTLS: false,
        ...(options.user
          ? { auth: { user: options.user, pass: options.password } }
          : {}),
        connectionTimeout: options.timeoutMs,
        greetingTimeout: options.timeoutMs,
        socketTimeout: options.timeoutMs,
        dnsTimeout: options.timeoutMs,
        maxResponseSize: 16 * 1024,
        logger: false,
        debug: false,
        transactionLog: false,
        disableFileAccess: true,
        disableUrlAccess: true,
        getSocket(_configuration, callback) {
          if (active.aborted || closed) {
            callback(new Error("SMTP operation stopped."));
            return;
          }
          let returned = false;
          socket = options.secure
            ? tlsConnect({
                host: options.host,
                port: options.port,
                servername: options.host,
                rejectUnauthorized: true,
                minVersion: "TLSv1.2",
              })
            : netConnect({ host: options.host, port: options.port });
          sockets.add(socket);
          socket.once("close", () => {
            if (socket) sockets.delete(socket);
            if (!returned) {
              returned = true;
              callback(new Error("SMTP operation stopped."));
            }
          });
          socket.once("error", (error) => {
            if (!returned) {
              returned = true;
              callback(error);
            }
          });
          socket.once(options.secure ? "secureConnect" : "connect", () => {
            if (returned) return;
            returned = true;
            connected = true;
            callback(null, {
              connection: socket!,
              ...(options.secure ? { secured: true } : {}),
            });
          });
          if (active.aborted) abort();
        },
      });
      try {
        const result = await transport.sendMail({
          from: options.from,
          to: recipient,
          ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}),
          envelope: { from: options.from, to: [recipient] },
          messageId: `<${command.messageId}@tholi.invalid>`,
          subject: rendered.subject,
          text: rendered.text,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        return result.accepted.length === 1 && result.rejected.length === 0
          ? "accepted"
          : "uncertain";
      } catch (error) {
        // Nodemailer may label a socket close after DATA as CONN. Only a
        // never-connected socket or explicit pre-DATA rejection proves no send.
        const { command, responseCode } = error as {
          command?: unknown;
          responseCode?: unknown;
        };
        return !connected ||
          (typeof command === "string" &&
            /^(?:EHLO|HELO|STARTTLS|AUTH(?: PLAIN| LOGIN)?|MAIL FROM|RCPT TO)$/.test(
              command,
            ) &&
            typeof responseCode === "number" &&
            responseCode >= 400 &&
            responseCode <= 599)
          ? "not-sent"
          : "uncertain";
      } finally {
        active.removeEventListener("abort", abort);
        socket?.destroy();
        transport.close();
      }
    },
    async close() {
      closed = true;
      for (const socket of sockets)
        socket.destroy(new Error("SMTP operation stopped."));
      sockets.clear();
    },
  };
}
