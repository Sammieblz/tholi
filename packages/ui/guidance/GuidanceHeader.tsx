import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  Settings,
  Expand,
  Restart,
  MoreHoriz,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Plus,
} from "iconoir-react";
import type { GuidanceProps } from "./types";
import type { WidgetDensity } from "../widget-density";
import { SessionActions } from "./CurrentStep";
export function GuidanceHeader(
  props: GuidanceProps & {
    density?: WidgetDensity;
    onShowDetails?: () => void;
  },
) {
  const prefs = props.preferences;
  const [settings, setSettings] = useState(false);
  return (
    <header className="tholi-header">
      <img className="tholi-logo" src={props.logo} alt="Tholi" />
      <div className="tholi-header-actions">
        {!props.hideSettings && (
          <Popover.Root open={settings} onOpenChange={setSettings}>
            <Popover.Trigger
              className="icon-button"
              aria-label={props.widget ? "Widget menu" : "Tholi settings"}
            >
              {props.widget ? (
                <MoreHoriz width={20} aria-hidden="true" />
              ) : (
                <Settings width={20} aria-hidden="true" />
              )}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={8}>
                <Popover.Popup className="tholi-popover tholi-settings-popup">
                  <Popover.Title>
                    {props.widget ? "Widget controls" : "Make Tholi yours"}
                  </Popover.Title>
                  {!props.widget && props.account}
                  {props.widget && (
                    <>
                      <div
                        className="tholi-menu-modes"
                        aria-label="Guidance view"
                      >
                        <button
                          aria-pressed={prefs.mode === "guide"}
                          onClick={() => {
                            props.onPreferences({ ...prefs, mode: "guide" });
                            setSettings(false);
                          }}
                        >
                          Guide
                        </button>
                        <button
                          aria-pressed={prefs.mode === "conversation"}
                          onClick={() => {
                            props.onPreferences({
                              ...prefs,
                              mode: "conversation",
                            });
                            setSettings(false);
                          }}
                        >
                          Conversation
                        </button>
                      </div>
                      {(props.density === "compact" ||
                        props.density === "minimal") && (
                        <SessionActions
                          {...props}
                          onCommand={(type) => {
                            props.onCommand(type);
                            setSettings(false);
                          }}
                        />
                      )}
                      <button
                        onClick={() => {
                          props.onExpand?.(false);
                          setSettings(false);
                        }}
                      >
                        <Expand width={17} aria-hidden="true" /> Expand widget
                      </button>
                      <button
                        onClick={() => {
                          props.onShowDetails?.();
                          setSettings(false);
                        }}
                      >
                        Journey details
                      </button>
                      {props.onWidgetLayout && (
                        <fieldset className="tholi-position-controls">
                          <legend>Position and size</legend>
                          <div>
                            {(
                              [
                                ["left", ArrowLeft],
                                ["right", ArrowRight],
                                ["up", ArrowUp],
                                ["down", ArrowDown],
                                ["smaller", Minus],
                                ["larger", Plus],
                              ] as const
                            ).map(([action, Icon]) => (
                              <button
                                key={action}
                                aria-label={
                                  action[0].toUpperCase() + action.slice(1)
                                }
                                onClick={() => props.onWidgetLayout?.(action)}
                              >
                                <Icon width={17} aria-hidden="true" />
                                {action[0].toUpperCase() + action.slice(1)}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => props.onWidgetLayout?.("reset")}
                          >
                            <Restart width={17} aria-hidden="true" />
                            Reset position
                          </button>
                        </fieldset>
                      )}
                    </>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={prefs.advanced}
                      onChange={(e) => {
                        props.onPreferences({
                          ...prefs,
                          advanced: e.target.checked,
                        });
                        if (props.widget && e.target.checked)
                          props.onExpand?.(false);
                      }}
                    />
                    Advanced controls
                  </label>
                  {props.assistanceAvailable && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!prefs.assisted}
                          aria-describedby="tholi-assistance-description"
                          onChange={(event) =>
                            props.onPreferences({
                              ...prefs,
                              assisted: event.target.checked,
                            })
                          }
                        />
                        Assisted navigation
                      </label>
                      <p id="tholi-assistance-description" className="small">
                        Tholi may open menus and select requested view options.
                        You handle forms, sign-in and final actions. Turn this
                        off or Pause to take over.
                      </p>
                    </>
                  )}
                  <button
                    onClick={() => {
                      if (props.widget && props.onDock) {
                        props.onDock();
                        setSettings(false);
                        return;
                      }
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
                      : "Dock to sidebar"}
                  </button>
                  {props.onResetSession && (
                    <AlertDialog.Root>
                      <AlertDialog.Trigger className="tholi-reset-session">
                        <Restart width={17} aria-hidden="true" />
                        Reset current session
                      </AlertDialog.Trigger>
                      <AlertDialog.Portal>
                        <AlertDialog.Backdrop className="tholi-dialog-backdrop" />
                        <AlertDialog.Popup className="tholi-confirm-dialog">
                          <AlertDialog.Title>
                            Reset this session?
                          </AlertDialog.Title>
                          <AlertDialog.Description>
                            This clears unfinished journeys, your draft and this
                            conversation. Saved routes and learned website
                            knowledge stay available.
                          </AlertDialog.Description>
                          <div>
                            <AlertDialog.Close>
                              Keep my session
                            </AlertDialog.Close>
                            <AlertDialog.Close
                              className="tholi-reset-session"
                              onClick={() => {
                                props.onResetSession?.();
                                setSettings(false);
                              }}
                            >
                              <Restart width={17} aria-hidden="true" />
                              Reset session
                            </AlertDialog.Close>
                          </div>
                        </AlertDialog.Popup>
                      </AlertDialog.Portal>
                    </AlertDialog.Root>
                  )}
                  {props.widget && (
                    <p className="small">
                      <button onClick={props.onMoveAside}>Move aside</button>
                      Backend credentials and advanced tools are available in
                      the sidebar.
                    </p>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>
    </header>
  );
}
