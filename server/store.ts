import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Room, Track } from "../src/lib/types";

const DEMO: Track[] = [
  {
    id: "demo-night",
    title: "Night Garden",
    artist: "MT House",
    url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/night-garden.mp3",
    addedBy: "Library",
    duration: 16,
  },
  {
    id: "demo-lot",
    title: "Lot Lights",
    artist: "MT House",
    url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/lot-lights.mp3",
    addedBy: "Library",
    duration: 16,
  },
  {
    id: "demo-empty",
    title: "Empty House",
    artist: "MT House",
    url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/empty-house.mp3",
    addedBy: "Library",
    duration: 16,
  },
];

type G = typeof globalThis & {
  __jbRoom?: Room;
  __jbAudio?: Map<string, { buf: Buffer; mime: string; title: string }>;
  __jbConfig?: { token: string; chatId: string; appUrl: string };
};

const g = globalThis as G;
const tmpDir = "/tmp/mt-jukebox-data";

function emptyRoom(): Room {
  return {
    hostId: null,
    hostName: "",
    current: null,
    startedAt: null,
    paused: true,
    pausePos: 0,
    queue: [],
    library: DEMO.map((t) => ({ ...t })),
    listeners: [],
    connected: Boolean(g.__jbConfig?.token || process.env.BOT_TOKEN),
  };
}

function persist() {
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "room.json"), JSON.stringify(g.__jbRoom));
    if (g.__jbConfig) {
      writeFileSync(join(tmpDir, "config.json"), JSON.stringify(g.__jbConfig));
    }
  } catch {
    /* preview fs is best-effort */
  }
}

function hydrate() {
  if (!g.__jbRoom) {
    try {
      if (existsSync(join(tmpDir, "room.json"))) {
        g.__jbRoom = JSON.parse(readFileSync(join(tmpDir, "room.json"), "utf8")) as Room;
      }
    } catch {
      /* ignore */
    }
    g.__jbRoom ??= emptyRoom();
  }
  if (!g.__jbConfig) {
    try {
      if (existsSync(join(tmpDir, "config.json"))) {
        g.__jbConfig = JSON.parse(readFileSync(join(tmpDir, "config.json"), "utf8"));
      }
    } catch {
      /* ignore */
    }
  }
  if (!g.__jbAudio) g.__jbAudio = new Map();
  g.__jbRoom.connected = Boolean(g.__jbConfig?.token || process.env.BOT_TOKEN);
}

export function getRoom(): Room {
  hydrate();
  const now = Date.now();
  g.__jbRoom!.listeners = g.__jbRoom!.listeners.filter((l) => now - l.seen < 20000);
  return g.__jbRoom!;
}

export function heartbeat(id: string, name: string) {
  const room = getRoom();
  const found = room.listeners.find((l) => l.id === id);
  if (found) {
    found.seen = Date.now();
    found.name = name;
  } else {
    room.listeners.push({ id, name, seen: Date.now() });
  }
  persist();
  return room;
}

export function addTrack(track: Track, playNow: boolean) {
  const room = getRoom();
  room.library = [track, ...room.library.filter((t) => t.id !== track.id)].slice(0, 40);
  if (!room.current || playNow) {
    startTrack(track);
  } else {
    room.queue.push(track);
  }
  persist();
  return room;
}

export function startTrack(track: Track) {
  const room = getRoom();
  room.current = track;
  room.startedAt = Date.now();
  room.paused = false;
  room.pausePos = 0;
  persist();
}

export function playPause(userId: string) {
  const room = getRoom();
  if (!room.hostId) {
    room.hostId = userId;
  }
  if (room.hostId !== userId) return room;
  if (!room.current) {
    const next = room.queue.shift() ?? room.library[0];
    if (next) startTrack(next);
    return room;
  }
  if (room.paused) {
    room.startedAt = Date.now() - room.pausePos * 1000;
    room.paused = false;
  } else {
    room.pausePos = room.startedAt ? (Date.now() - room.startedAt) / 1000 : 0;
    room.paused = true;
  }
  persist();
  return room;
}

export function skip(userId: string) {
  const room = getRoom();
  if (room.hostId && room.hostId !== userId) return room;
  room.hostId = userId;
  const next = room.queue.shift();
  if (next) startTrack(next);
  else {
    room.current = null;
    room.startedAt = null;
    room.paused = true;
    room.pausePos = 0;
  }
  persist();
  return room;
}

export function claimHost(userId: string, name: string) {
  const room = getRoom();
  if (!room.hostId || !room.listeners.some((l) => l.id === room.hostId)) {
    room.hostId = userId;
    room.hostName = name;
    persist();
  }
  return room;
}

export function saveAudio(title: string, buf: Buffer, mime: string) {
  hydrate();
  const id = randomUUID();
  g.__jbAudio!.set(id, { buf, mime, title });
  return id;
}

export function getAudio(id: string) {
  hydrate();
  return g.__jbAudio!.get(id) ?? null;
}

export function botConfig() {
  hydrate();
  return {
    token: g.__jbConfig?.token || process.env.BOT_TOKEN || "",
    chatId: g.__jbConfig?.chatId || process.env.CHAT_ID || "",
    appUrl: g.__jbConfig?.appUrl || process.env.APP_URL || "",
  };
}

export function setBotConfig(token: string, chatId: string, appUrl: string) {
  hydrate();
  g.__jbConfig = { token, chatId, appUrl };
  persist();
}

export function newId() {
  return randomUUID();
}
