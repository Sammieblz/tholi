import { Accordion } from "@base-ui/react/accordion";
import { NavArrowDown } from "iconoir-react";
import type { ReactNode } from "react";

export function Disclosure({
  title,
  children,
  label,
  description,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  label?: string;
  description?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Accordion.Root
      className="tholi-disclosures"
      defaultValue={defaultOpen ? ["content"] : []}
    >
      <Accordion.Item
        value="content"
        className="tholi-disclosure"
        aria-label={label}
      >
        <Accordion.Header>
          <Accordion.Trigger className="tholi-disclosure-trigger">
            <span>
              <strong>{title}</strong>
              {description && <small>{description}</small>}
            </span>
            <NavArrowDown width={17} aria-hidden="true" />
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="tholi-disclosure-panel">
          <div>{children}</div>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
