import { botConfig, setBotConfig } from "./store";

async function tg(method: string, body: Record<string, unknown>) {
  const { token } = botConfig();
  if (!token) throw new Error("Add a bot token first");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description || "Telegram said no");
  return data;
}

export async function connectBot(appUrl: string) {
  const { chatId } = botConfig();
  await tg("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Jukebox",
      web_app: { url: appUrl },
    },
  });
  await tg("setMyCommands", {
    commands: [{ command: "jukebox", description: "Open the group jukebox" }],
  });
  if (chatId) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Jukebox is on. Tap Open — everyone in this chat hears the same queue.",
      reply_markup: {
        inline_keyboard: [[{ text: "Open jukebox", web_app: { url: appUrl } }]],
      },
    });
  }
}

export async function announceNowPlaying(title: string, by: string) {
  const { chatId } = botConfig();
  if (!chatId) return;
  try {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Now playing: ${title} — added by ${by}`,
    });
  } catch {
    /* group may not have the bot yet */
  }
}

export async function handleUpdate(update: {
  message?: {
    text?: string;
    chat: { id: number; type?: string; title?: string };
    from?: { first_name?: string };
  };
  my_chat_member?: { chat: { id: number; title?: string } };
}) {
  const chat =
    update.message?.chat || update.my_chat_member?.chat;
  if (!chat) return;
  const { token, appUrl } = botConfig();
  const url = appUrl || process.env.APP_URL || "";
  if (token && !botConfig().chatId) {
    setBotConfig(token, String(chat.id), url);
  }
  const text = update.message?.text ?? "";
  const isCommand = /^\/(jukebox|start)(@\w+)?/.test(text);
  const added = Boolean(update.my_chat_member);
  if (!isCommand && !added) return;
  if (!url) return;
  await tg("sendMessage", {
    chat_id: chat.id,
    text: added
      ? "Jukebox joined this group. Tap Open so everyone can hear the same queue."
      : "Open the jukebox to join the room.",
    reply_markup: {
      inline_keyboard: [[{ text: "Open jukebox", web_app: { url } }]],
    },
  });
  try {
    await tg("setChatMenuButton", {
      chat_id: chat.id,
      menu_button: {
        type: "web_app",
        text: "Jukebox",
        web_app: { url },
      },
    });
  } catch {
    /* menu button in groups needs admin */
  }
}
