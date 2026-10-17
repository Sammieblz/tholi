import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
type RouteLocation = {
  path: string;
  hash: string;
  search: string;
  key: string;
  returning: boolean;
};
const RouterContext = createContext({
  path: "/",
  hash: "",
  go: (_path: string) => {},
});
let nextKey = 0;
function locationKey() {
  const key = history.state?.tholiKey;
  if (typeof key === "string") return key;
  const created = `tholi-${Date.now()}-${nextKey++}`;
  history.replaceState({ ...history.state, tholiKey: created }, "");
  return created;
}
function readLocation(returning = false): RouteLocation {
  return {
    path: location.pathname,
    hash: location.hash,
    search: location.search,
    key: locationKey(),
    returning,
  };
}
function mountedRouteElement(element: HTMLElement | null): HTMLElement | null {
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    if (
      ancestor.hidden ||
      ancestor.style.display === "none" ||
      ancestor.getAttribute("aria-hidden") === "true"
    )
      return null;
  }
  return element;
}
export function Router({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(readLocation);
  const currentKey = useRef(route.key);
  const scrollPositions = useRef(
    new Map<string, { left: number; top: number }>(),
  );
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const change = () => {
      const next = readLocation(true);
      if (next.key !== currentKey.current) {
        scrollPositions.current.set(currentKey.current, {
          left: scrollX,
          top: scrollY,
        });
        currentKey.current = next.key;
      }
      setRoute((current) =>
        current.key === next.key &&
        current.hash === next.hash &&
        current.path === next.path &&
        current.search === next.search
          ? current
          : next,
      );
    };
    addEventListener("popstate", change);
    addEventListener("hashchange", change);
    return () => {
      history.scrollRestoration = previous;
      removeEventListener("popstate", change);
      removeEventListener("hashchange", change);
    };
  }, []);
  useEffect(() => {
    let fragment = "";
    try {
      fragment = decodeURIComponent(route.hash.slice(1));
    } catch {
      /* Malformed fragments remain harmless. */
    }
    let frame = 0;
    let finished = false;
    const finish = (allowMissingFragment = false) => {
      if (finished) return;
      const heading =
        Array.from(document.querySelectorAll<HTMLElement>("main h1"))
          .map(mountedRouteElement)
          .find(Boolean) || null;
      if (heading)
        document.title = `${heading.textContent?.trim() || "Tholi"} | Tholi`;
      // A lazy route may have mounted only its loading status. Wait for the
      // actual article and fragment rather than focusing a fabricated heading.
      const target =
        (fragment
          ? mountedRouteElement(document.getElementById(fragment))
          : heading) || (allowMissingFragment ? heading : null);
      if (!target) return;
      finished = true;
      observer.disconnect();
      clearTimeout(deadline);
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      if (fragment && target)
        target.scrollIntoView({ block: "start", behavior: "instant" });
      else {
        const restored = route.returning
          ? scrollPositions.current.get(route.key)
          : undefined;
        window.scrollTo({
          ...(restored || { top: 0, left: 0 }),
          behavior: "instant",
        });
      }
    };
    const schedule = () => {
      if (finished || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        finish();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.querySelector("main") || document.body, {
      childList: true,
      subtree: true,
    });
    const deadline = setTimeout(() => {
      observer.disconnect();
      finish(true);
    }, 10_000);
    schedule();
    return () => {
      finished = true;
      observer.disconnect();
      clearTimeout(deadline);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [route]);
  const go = useCallback((destination: string) => {
    const next = new URL(destination, location.href);
    if (
      next.origin !== location.origin ||
      !["http:", "https:"].includes(next.protocol)
    )
      return;
    const url = `${next.pathname}${next.search}${next.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) {
      scrollPositions.current.set(currentKey.current, {
        left: scrollX,
        top: scrollY,
      });
      history.pushState(
        { tholiKey: `tholi-${Date.now()}-${nextKey++}` },
        "",
        url,
      );
    }
    const nextRoute = readLocation();
    currentKey.current = nextRoute.key;
    setRoute(nextRoute);
  }, []);
  return (
    <RouterContext.Provider value={{ path: route.path, hash: route.hash, go }}>
      {children}
    </RouterContext.Provider>
  );
}
export const useRouter = () => useContext(RouterContext);
export function SiteLink({
  to,
  onClick,
  ...props
}: ComponentProps<"a"> & { to: string }) {
  const { go } = useRouter();
  return (
    <a
      {...props}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.download !== undefined ||
          (props.target && props.target !== "_self")
        )
          return;
        const destination = new URL(to, location.href);
        if (
          destination.origin !== location.origin ||
          !["http:", "https:"].includes(destination.protocol)
        )
          return;
        event.preventDefault();
        go(to);
      }}
    />
  );
}
