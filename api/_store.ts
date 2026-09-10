type Track = {
  id: string;
  title: string;
  artist: string;
  url: string;
  addedBy: string;
  duration: number;
  kind?: string;
  spotifyUri?: string;
};
type Room = {
  hostId: string | null;
  hostName: string;
  current: Track | null;
  startedAt: number | null;
  paused: boolean;
  pausePos: number;
  queue: Track[];
  library: Track[];
  listeners: { id: string; name: string; seen: number }[];
  connected: boolean;
};

function bag() {
  const g = globalThis as typeof globalThis & {
    __jb?: { room: Room; audio: Map<string, { buf: Buffer; mime: string }> };
  };
  if (!g.__jb) {
    g.__jb = {
      room: {
        hostId: null,
        hostName: "",
        current: null,
        startedAt: null,
        paused: true,
        pausePos: 0,
        queue: [],
        library: [],
        listeners: [],
        connected: true,
      },
      audio: new Map(),
    };
  }
  return g.__jb;
}

export function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getRoom(): Room {
  const room = bag().room;
  const now = Date.now();
  room.listeners = room.listeners.filter((l) => now - l.seen < 25000);
  if (room.current && !room.paused && room.startedAt && room.current.duration) {
    if ((now - room.startedAt) / 1000 >= room.current.duration + 0.3) skip("sys");
  }
  return room;
}

export function heartbeat(id: string, name: string) {
  const room = getRoom();
  const found = room.listeners.find((l) => l.id === id);
  if (found) {
    found.seen = Date.now();
    if (name) found.name = name;
  } else {
    room.listeners.push({ id, name: name || "Listener", seen: Date.now() });
  }
  if (!room.hostId || !room.listeners.some((l) => l.id === room.hostId)) {
    room.hostId = id;
    room.hostName = name || "Listener";
  }
  return room;
}

export function startTrack(track: Track) {
  const room = getRoom();
  room.current = track;
  room.startedAt = Date.now();
  room.paused = false;
  room.pausePos = 0;
  return room;
}

export function addTrack(track: Track, playNow: boolean) {
  const room = getRoom();
  room.library = [track, ...room.library.filter((t) => t.id !== track.id)].slice(0, 200);
  if (!room.current || playNow) startTrack(track);
  else room.queue.push(track);
  return room;
}

export function play(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  room.hostId = userId;
  if (name) room.hostName = name;
  if (!room.current) {
    const next = room.queue.shift() || room.library[0];
    if (next) startTrack(next);
    return room;
  }
  if (room.paused) {
    room.startedAt = Date.now() - room.pausePos * 1000;
    room.paused = false;
  }
  return room;
}

export function pause(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  if (!room.current || room.paused) return room;
  room.pausePos = room.startedAt ? (Date.now() - room.startedAt) / 1000 : 0;
  room.paused = true;
  return room;
}

export function playPause(userId: string, name?: string) {
  const room = getRoom();
  if (room.paused || !room.current) return play(userId, name);
  return pause(userId, name);
}

export function skip(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  const next = room.queue.shift();
  if (next) startTrack(next);
  else {
    room.current = null;
    room.startedAt = null;
    room.paused = true;
    room.pausePos = 0;
  }
  return room;
}

export function queueTrack(trackId: string, userId: string, name: string) {
  heartbeat(userId, name);
  const room = getRoom();
  const track = room.library.find((t) => t.id === trackId);
  if (!track) return room;
  const copy = { ...track, addedBy: name, id: newId() };
  if (!room.current) startTrack(copy);
  else room.queue.push(copy);
  return room;
}

export function removeFromQueue(trackId: string) {
  const room = getRoom();
  room.queue = room.queue.filter((t) => t.id !== trackId);
  return room;
}

export function deleteTrack(trackId: string) {
  const room = getRoom();
  room.queue = room.queue.filter((t) => t.id !== trackId);
  room.library = room.library.filter((t) => t.id !== trackId);
  bag().audio.delete(trackId);
  if (room.current && room.current.id === trackId) skip("sys");
  return room;
}

export function saveAudio(buf: Buffer, mime: string) {
  const id = newId();
  bag().audio.set(id, { buf, mime });
  return id;
}

export function getAudio(id: string) {
  return bag().audio.get(id) || null;
}

export async function lyricsFor(track: Track | null) {
  if (!track) return "Nothing is playing.";
  const title = stripFileJunk(track.title);
  const artist = stripFileJunk(track.artist);
  const q = encodeURIComponent([artist, title].filter(Boolean).join(" ").trim() || title);
  try {
    const r = await fetch("https://lrclib.net/api/search?q=" + q, { headers: { "User-Agent": "MT-Jukebox" } });
    const arr = (await r.json()) as { plainLyrics?: string; syncedLyrics?: string; trackName?: string }[];
    const hit = Array.isArray(arr) && arr.find((x) => x.plainLyrics || x.syncedLyrics);
    const text = (hit && (hit.plainLyrics || hit.syncedLyrics)) || "";
    if (text) return stripSync(text);
  } catch {
    /* try backup */
  }
  try {
    const r = await fetch(
      "https://api.lyrics.ovh/v1/" + encodeURIComponent(artist || "Unknown") + "/" + encodeURIComponent(title),
    );
    const j = (await r.json()) as { lyrics?: string };
    if (j.lyrics) return j.lyrics.trim();
  } catch {
    /* none */
  }
  return "No lyrics found for " + title + ".";
}

function stripSync(text: string) {
  return text.replace(/\[\d+:\d+[^\]]*\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function stripFileJunk(s: string) {
  return String(s || "")
    .replace(/\.(mp3|m4a|wav|aac|ogg|flac)$/i, "")
    .replace(/[_]+/g, " ")
    .trim();
}
