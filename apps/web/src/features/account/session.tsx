import { createContext, useContext, useState, type ReactNode } from "react";
export type DemoAccount = { name: string; email: string; onboarded: boolean };
const key = "tholi-demo-account";
function readAccount(): DemoAccount | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      value &&
      typeof value.name === "string" &&
      typeof value.email === "string" &&
      typeof value.onboarded === "boolean"
    )
      return value;
  } catch {
    /* Download remains usable when session storage is unavailable. */
  }
}
const AccountContext = createContext<{
  account?: DemoAccount;
  save: (a: DemoAccount) => void;
  signOut: () => void;
}>({ save: () => {}, signOut: () => {} });
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(readAccount);
  const save = (next: DemoAccount) => {
    sessionStorage.setItem(key, JSON.stringify(next));
    setAccount(next);
  };
  const signOut = () => {
    sessionStorage.removeItem(key);
    setAccount(undefined);
  };
  return (
    <AccountContext.Provider value={{ account, save, signOut }}>
      {children}
    </AccountContext.Provider>
  );
}
export const useAccount = () => useContext(AccountContext);
