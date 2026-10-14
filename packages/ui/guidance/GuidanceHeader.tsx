import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Settings, Expand } from "iconoir-react";
import type { GuidanceProps } from "./types";
export function GuidanceHeader(props: GuidanceProps) {
  const prefs = props.preferences;
  const [settings, setSettings] = useState(false);
  return (
    <header className="tholi-header">
      <img className="tholi-logo" src={props.logo} alt="Tholi" />
      <div className="tholi-header-actions">
        {props.widget && (
          <button
            className="icon-button"
            aria-label="Expand widget"
            onClick={props.onExpand}
          >
            <Expand width={20} />
          </button>
        )}
        <Popover.Root open={settings} onOpenChange={setSettings}>
          <Popover.Trigger className="icon-button" aria-label="Tholi settings">
            <Settings width={20} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={8}>
              <Popover.Popup className="tholi-popover">
                <Popover.Title>Make Tholi yours</Popover.Title>
                <label>
                  <input
                    type="checkbox"
                    checked={prefs.advanced}
                    onChange={(e) =>
                      props.onPreferences({
                        ...prefs,
                        advanced: e.target.checked,
                      })
                    }
                  />
                  Advanced controls
                </label>
                <button
                  onClick={() => {
                    props.onPreferences({
                      ...prefs,
                      surface:
                        prefs.surface === "sidebar" ? "widget" : "sidebar",
                    });
                    setSettings(false);
                  }}
                >
                  {prefs.surface === "sidebar"
                    ? "Use floating widget"
                    : "Use sidebar"}
                </button>
                {props.widget && (
                  <p className="small">
                    <button onClick={props.onMoveAside}>Move aside</button>
                    Backend credentials and advanced tools are available in the
                    sidebar.
                  </p>
                )}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </header>
  );
}
