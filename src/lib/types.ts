export type Track = {
  id: string;
  title: string;
  artist: string;
  url: string;
  addedBy: string;
  duration: number;
  kind?: "mp3" | "spotify";
  spotifyUri?: string;
};

export type Listener = {
  id: string;
  name: string;
  seen: number;
};

export type Room = {
  hostId: string | null;
  hostName: string;
  current: Track | null;
  startedAt: number | null;
  paused: boolean;
  pausePos: number;
  queue: Track[];
  library: Track[];
  listeners: Listener[];
  connected: boolean;
};

export type Identity = {
  id: string;
  name: string;
};
