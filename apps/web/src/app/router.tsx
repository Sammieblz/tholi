import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
const RouterContext = createContext({ path: "/", go: (_path: string) => {} });
export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const change = () => setPath(location.pathname);
    addEventListener("popstate", change);
    return () => removeEventListener("popstate", change);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      document.title = `${heading.textContent?.trim() || "Tholi"} | Tholi`;
    });
    return () => cancelAnimationFrame(frame);
  }, [path]);
  const go = (next: string) => {
    if (next !== location.pathname) history.pushState({}, "", next);
    setPath(next);
  };
  return (
    <RouterContext.Provider value={{ path, go }}>
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
          event.altKey
        )
          return;
        event.preventDefault();
        go(to);
      }}
    />
  );
}
