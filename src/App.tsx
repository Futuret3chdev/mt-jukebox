import { useEffect, useMemo, useRef, useState } from "react";
import { bootTelegram, identity, setLocalName } from "./lib/telegram";
import {
  finishSpotifyLogin,
  getSpotifyClientId,
  searchTracks,
  setSpotifyClientId,
  spotifyToken,
  startSpotifyLogin,
} from "./lib/spotify";
import type { Room, Track } from "./lib/types";

const LOGO = "https://memetorrent.futuret3ch.com.au/logo.png";

function fmt(secs: number) {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function positionOf(room: Room) {
  if (!room.current) return 0;
  if (room.paused) return room.pausePos;
  if (!room.startedAt) return 0;
  return Math.max(0, (Date.now() - room.startedAt) / 1000);
}

export function App() {
  const me = useMemo(() => identity(), []);
  const [room, setRoom] = useState<Room | null>(null);
  const [joined, setJoined] = useState(false);
  const [tab, setTab] = useState<"queue" | "library" | "spotify">("library");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pos, setPos] = useState(0);
  const [spId, setSpId] = useState(() => getSpotifyClientId());
  const [spQuery, setSpQuery] = useState("");
  const [spHits, setSpHits] = useState<{ id: string; name: string; uri: string; duration_ms: number; artists: { name: string }[] }[]>([]);
  const [spOn, setSpOn] = useState(() => Boolean(spotifyToken()));
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastId = useRef("");

  async function refresh() {
    const q = new URLSearchParams({ id: me.id, name: me.name });
    const res = await fetch(`/api/room?${q}`);
    if (!res.ok) return;
    setRoom((await res.json()) as Room);
  }

  async function action(type: string, extra: Record<string, string | number> = {}) {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id: me.id, name: me.name, ...extra }),
    });
    if (res.ok) setRoom((await res.json()) as Room);
  }

  useEffect(() => {
    bootTelegram();
    void finishSpotifyLogin().then((okLogin) => {
      if (okLogin) setSpOn(true);
    });
  }, []);

  useEffect(() => {
    if (!joined) return;
    void refresh();
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [joined, me.id, me.name]);

  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => setPos(room ? positionOf(room) : 0), 250);
    return () => clearInterval(t);
  }, [joined, room]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !joined || !room?.current) {
      el?.pause();
      return;
    }
    if (room.current.kind === "spotify") {
      el.pause();
      return;
    }
    const abs = new URL(room.current.url, window.location.origin).href;
    if (el.src !== abs) el.src = room.current.url;
    const want = positionOf(room);
    if (Math.abs(el.currentTime - want) > 0.8) el.currentTime = want;
    if (room.paused) void el.pause();
    else void el.play().catch(() => undefined);
  }, [joined, room]);

  async function onUpload(file: File) {
    setError("");
    const title = file.name.replace(/\.[^.]+$/, "");
    const q = new URLSearchParams({ title, name: me.name, id: me.id });
    const res = await fetch(`/api/upload?${q}`, { method: "POST", body: file });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not add that track");
      return;
    }
    setRoom(data);
    setTab("queue");
    setOk(`Added ${title}`);
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setSpHits(await searchTracks(spQuery));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spotify search failed");
    }
  }

  const duration = room?.current?.duration || audioRef.current?.duration || 0;
  const pct = duration > 0 ? Math.min(100, (pos / duration) * 100) : 0;
  const isHost = room?.hostId === me.id || !room?.hostId;
  const spotifyNow = room?.current?.kind === "spotify";

  if (!joined) {
    return (
      <div className="app">
        <div className="brand">
          <img src={LOGO} alt="MemeTorrent" />
          <p className="kicker">MemeTorrent</p>
        </div>
        <h1>Jukebox</h1>
        <p style={{ color: "var(--fg-muted)" }}>
          One room. One queue. Everyone hears the same mp3 at the same time.
        </p>
        <div className="join-card" style={{ marginTop: 32, padding: 0, background: "none" }}>
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            type="text"
            defaultValue={me.name === "Guest" ? "" : me.name}
            placeholder="Name in the room"
            onChange={(e) => setLocalName(e.target.value || "Guest")}
          />
          <button type="button" className="btn primary" style={{ width: "100%" }} onClick={() => setJoined(true)}>
            Join the room
          </button>
          <p className="hint" style={{ marginTop: 16 }}>
            iPhone needs this tap so the speaker is allowed to play.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="brand">
        <img src={LOGO} alt="MemeTorrent" />
        <p className="kicker">MemeTorrent · live</p>
      </div>
      <h1>Jukebox</h1>
      <div className="disc-wrap">
        <div className={room?.current && !room.paused ? "disc spin" : "disc"}>
          <img src={LOGO} alt="" />
        </div>
      </div>
      <div className="now">
        <h2>{room?.current?.title ?? "Nothing on"}</h2>
        <p>
          {room?.current
            ? `${room.current.artist} · ${room.current.addedBy}${spotifyNow ? " · Spotify" : ""}`
            : "Queue a track from the library"}
        </p>
        {spotifyNow && !spOn ? (
          <p className="hint">Host is on Spotify. Mp3s in the queue still play for everyone.</p>
        ) : null}
        <div className="bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="times">
          <span>{fmt(pos)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
      <div className="controls">
        <button type="button" className="btn primary" disabled={!isHost && Boolean(room?.hostId)} onClick={() => void action("play")}>
          {room?.current && !room.paused ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn ghost" onClick={() => void action("skip")}>
          Skip
        </button>
      </div>
      <p className="meta">
        <span>{room?.listeners.length ?? 0} in the room</span>
        <span>{isHost ? "You have the aux" : `Host · ${room?.hostName || "someone"}`}</span>
      </p>
      <div className="tabs">
        <button type="button" className={tab === "library" ? "on" : ""} onClick={() => setTab("library")}>
          Library
        </button>
        <button type="button" className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
          Queue {room?.queue.length ? `(${room.queue.length})` : ""}
        </button>
        <button type="button" className={tab === "spotify" ? "on" : ""} onClick={() => setTab("spotify")}>
          Spotify
        </button>
      </div>
      {tab === "library" && (
        <div className="panel">
          <h3>Add mp3s</h3>
          <button type="button" className="btn ghost" style={{ width: "100%", marginBottom: 8 }} onClick={() => fileRef.current?.click()}>
            Upload from this phone
          </button>
          <p className="hint">Several files at once. Over 4.5 MB — drop them in SoftwareTesters and the bot queues them.</p>
          <input
            ref={fileRef}
            className="hidden-file"
            type="file"
            accept="audio/*,.mp3,.m4a,.wav"
            multiple
            onChange={(e) => {
              const files = [...(e.currentTarget.files || [])];
              e.currentTarget.value = "";
              void (async () => {
                for (const file of files) await onUpload(file);
              })();
            }}
          />
          {(room?.library ?? []).map((t: Track) => (
            <div className="row" key={t.id}>
              <div>
                <strong>{t.title}</strong>
                <span>
                  {t.artist}
                  {t.kind === "spotify" ? " · Spotify" : ""}
                </span>
              </div>
              <button type="button" onClick={() => void action("queue", { trackId: t.id })}>
                Queue
              </button>
            </div>
          ))}
        </div>
      )}
      {tab === "queue" && (
        <div className="panel">
          <h3>Up next</h3>
          {(room?.queue.length ?? 0) === 0 && <p className="hint">Empty. Upload or queue something.</p>}
          {room?.queue.map((t) => (
            <div className="row" key={t.id}>
              <div>
                <strong>{t.title}</strong>
                <span>{t.addedBy}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "spotify" && (
        <div className="panel">
          <h3>Host Spotify</h3>
          <p className="hint">
            Only the host needs Premium. Spotify plays on the host phone. Mp3s still play for the whole group at the
            same time.
          </p>
          <label htmlFor="spid">Client ID</label>
          <input
            id="spid"
            type="text"
            value={spId}
            onChange={(e) => {
              setSpId(e.target.value);
              setSpotifyClientId(e.target.value);
            }}
            placeholder="From developer.spotify.com/dashboard"
          />
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%", marginBottom: 12 }}
            onClick={() => void startSpotifyLogin().catch((err: Error) => setError(err.message))}
          >
            {spOn ? "Reconnect Spotify" : "Connect host Spotify"}
          </button>
          {spOn ? (
            <form onSubmit={(e) => void onSearch(e)}>
              <label htmlFor="q">Search catalogue</label>
              <input id="q" type="text" value={spQuery} onChange={(e) => setSpQuery(e.target.value)} placeholder="Song or artist" />
              <button type="submit" className="btn ghost" style={{ width: "100%", marginBottom: 8 }}>
                Search
              </button>
              {spHits.map((hit) => (
                <div className="row" key={hit.id}>
                  <div>
                    <strong>{hit.name}</strong>
                    <span>{hit.artists.map((a) => a.name).join(", ")}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void action("spotify", {
                        title: hit.name,
                        artist: hit.artists.map((a) => a.name).join(", "),
                        spotifyUri: hit.uri,
                        duration: Math.round(hit.duration_ms / 1000),
                      })
                    }
                  >
                    Queue
                  </button>
                </div>
              ))}
            </form>
          ) : null}
        </div>
      )}
      {error ? <p className="error">{error}</p> : null}
      {ok && tab === "library" ? <p className="ok">{ok}</p> : null}
      <audio
        ref={audioRef}
        playsInline
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          const id = room?.current?.id;
          if (!id || !el.duration || lastId.current === id + el.duration) return;
          lastId.current = id + el.duration;
          void action("duration", { trackId: id, duration: el.duration });
        }}
        onEnded={() => {
          if (isHost) void action("skip");
        }}
      />
    </div>
  );
}
