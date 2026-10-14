import { useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "../presentation";
export function Conversation({
  messages,
}: {
  messages: ConversationMessage[];
}) {
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = list.current?.closest<HTMLElement>(".tholi-body");
    if (!scroller) return;
    const onScroll = () => {
      const messages = list.current;
      if (messages)
        setFollow(
          scroller.scrollTop + scroller.clientHeight >=
            messages.offsetTop + messages.offsetHeight - 50,
        );
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!follow || !list.current) return;
    const scroller = list.current.closest<HTMLElement>(".tholi-body");
    if (scroller)
      scroller.scrollTop = Math.max(
        0,
        list.current.offsetTop +
          list.current.offsetHeight -
          scroller.clientHeight,
      );
  }, [messages.length, follow]);
  return (
    <section className="tholi-messages" ref={list} aria-label="Conversation">
      {messages.map((m) => (
        <article key={m.id} className={"tholi-message " + m.role}>
          <span className="sr-only">
            {m.role === "user" ? "You" : "Tholi"}:{" "}
          </span>
          {m.text}
        </article>
      ))}
    </section>
  );
}
