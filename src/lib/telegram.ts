import type { Identity } from "./types";

type TgUser = { id: number; first_name: string; username?: string };

function webApp() {
  return (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: TgUser; chat?: { id: number } }; ready?: () => void; expand?: () => void; setHeaderColor?: (c: string) => void } } }).Telegram?.WebApp;
}

export function bootTelegram() {
  const tg = webApp();
  tg?.ready?.();
  tg?.expand?.();
  tg?.setHeaderColor?.("#0a0a0b");
}

export function identity(): Identity {
  const user = webApp()?.initDataUnsafe?.user;
  if (user) {
    return { id: String(user.id), name: user.first_name || user.username || "Member" };
  }
  const key = "jb-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  const name = sessionStorage.getItem("jb-name") || "Guest";
  return { id, name };
}

export function setLocalName(name: string) {
  sessionStorage.setItem("jb-name", name);
}
