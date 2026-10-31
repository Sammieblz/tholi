import { useEffect } from "react";
import { useRouter } from "../../app/router";
import { AccountProvider } from "./session";
import { AuthPage } from "./AuthPage";
import { WelcomePage } from "./WelcomePage";

export function AccountRoute({ path }: { path: string }) {
  const { go } = useRouter();
  useEffect(() => {
    if (path === "/welcome") go("/account", { replace: true });
  }, [path, go]);
  return (
    <AccountProvider>
      {path === "/signin" || path === "/signup" ? (
        <AuthPage signup={path === "/signup"} />
      ) : (
        <WelcomePage path={path} />
      )}
    </AccountProvider>
  );
}
