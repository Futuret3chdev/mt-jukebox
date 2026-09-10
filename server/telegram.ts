import { addTrack, botConfig, getRoom, newId, setBotConfig } from "./store";

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
  const url = appUrl || "https://mt-house-jukebox.vercel.app/";
  await tg("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Jukebox",
      web_app: { url },
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
        inline_keyboard: [[{ text: "Open jukebox", url }]],
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
      text: `Queued: ${title} — added by ${by}`,
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
    audio?: { file_id: string; title?: string; performer?: string; duration?: number; file_name?: string };
    document?: { file_id: string; mime_type?: string; file_name?: string };
  };
  my_chat_member?: { chat: { id: number; title?: string } };
}) {
  const chat = update.message?.chat || update.my_chat_member?.chat;
  if (!chat) return;
  const { token, appUrl } = botConfig();
  const url = appUrl || process.env.APP_URL || "https://mt-house-jukebox.vercel.app/";
  if (token && !botConfig().chatId) {
    setBotConfig(token, String(chat.id), url);
  }

  const audio = update.message?.audio;
  const doc = update.message?.document;
  const isMp3 = Boolean(audio) || (doc && /audio|mpeg|mp3/i.test(`${doc.mime_type || ""} ${doc.file_name || ""}`));
  if (isMp3) {
    const fileId = audio?.file_id || doc?.file_id;
    if (!fileId || !token) return;
    const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const fileJson = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const path = fileJson.result?.file_path;
    if (!path) return;
    const title =
      audio?.title ||
      doc?.file_name?.replace(/\.[^.]+$/, "") ||
      "Untitled";
    const by = update.message?.from?.first_name || "Someone";
    addTrack(
      {
        id: newId(),
        title,
        artist: audio?.performer || by,
        url: `/api/audio/tg/${fileId}`,
        addedBy: by,
        duration: audio?.duration || 0,
        kind: "mp3",
      },
      !getRoom().current,
    );
    await tg("sendMessage", {
      chat_id: chat.id,
      text: `Added to the jukebox: ${title}`,
      reply_markup: {
        inline_keyboard: [[{ text: "Open jukebox", url }]],
      },
    });
    return;
  }

  const text = update.message?.text ?? "";
  const isCommand = /^\/(jukebox|start)(@\w+)?/.test(text);
  const added = Boolean(update.my_chat_member);
  if (!isCommand && !added) return;
  await tg("sendMessage", {
    chat_id: chat.id,
    text: added
      ? "Jukebox joined this group. Tap Open so everyone can hear the same queue."
      : "Open the jukebox to join the room.",
    reply_markup: {
      inline_keyboard: [[{ text: "Open jukebox", url }]],
    },
  });
}
