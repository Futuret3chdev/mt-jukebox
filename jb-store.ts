const DEMO = [
  {
    id: "demo-night",
    title: "Night Garden",
    artist: "MT House",
    url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/night-garden.mp3",
    addedBy: "Library",
    duration: 16,
    kind: "mp3",
  },
  {
    id: "demo-lot",
    title: "Lot Lights",
    artist: "MT House",
    url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/lot-lights.mp3",
    addedBy: "Library",
    duration: 16,
    kind: "mp3",
  },
  {
    id: "demo-empty",
    title: "Empty House",
    artist: "MT House",
    url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/empty-house.mp3",
    addedBy: "Library",
    duration: 16,
    kind: "mp3",
  },
];

function g() {
  const x = globalThis;
  if (!x.__jb) {
    x.__jb = {
      room: {
        hostId: null,
        hostName: "",
        current: null,
        startedAt: null,
        paused: true,
        pausePos: 0,
        queue: [],
        library: DEMO.map((t) => ({ ...t })),
        listeners: [],
        connected: true,
      },
      audio: new Map(),
    };
  }
  return x.__jb;
}

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getRoom() {
  const room = g().room;
  const now = Date.now();
  room.listeners = room.listeners.filter((l) => now - l.seen < 25000);
  if (room.current && !room.paused && room.startedAt && room.current.duration) {
    const pos = (now - room.startedAt) / 1000;
    if (pos >= room.current.duration + 0.3) skip(room.hostId || "sys");
  }
  return room;
}

export function heartbeat(id, name) {
  const room = getRoom();
  const found = room.listeners.find((l) => l.id === id);
  if (found) {
    found.seen = Date.now();
    found.name = name;
  } else {
    room.listeners.push({ id, name, seen: Date.now() });
  }
  if (!room.hostId || !room.listeners.some((l) => l.id === room.hostId)) {
    room.hostId = id;
    room.hostName = name;
  }
  return room;
}

export function startTrack(track) {
  const room = getRoom();
  room.current = track;
  room.startedAt = Date.now();
  room.paused = false;
  room.pausePos = 0;
  return room;
}

export function addTrack(track, playNow) {
  const room = getRoom();
  room.library = [track, ...room.library.filter((t) => t.id !== track.id)].slice(0, 200);
  if (!room.current || playNow) startTrack(track);
  else room.queue.push(track);
  return room;
}

export function playPause(userId) {
  const room = getRoom();
  if (!room.hostId) room.hostId = userId;
  if (room.hostId !== userId) return room;
  if (!room.current) {
    const next = room.queue.shift() || room.library[0];
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
  return room;
}

export function skip(userId) {
  const room = getRoom();
  if (room.hostId && room.hostId !== userId && userId !== "sys") return room;
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

export function saveAudio(buf, mime, title) {
  const id = newId();
  g().audio.set(id, { buf, mime, title });
  return id;
}

export function getAudio(id) {
  return g().audio.get(id) || null;
}

export { newId };
