import { useEffect, useMemo, useRef, useState } from "react";
import { bootTelegram, identity, setLocalName } from "./lib/telegram";
import type { Room } from "./lib/types";

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
  const [tab, setTab] = useState<"queue" | "library" | "connect">("library");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [pos, setPos] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const q = new URLSearchParams({ id: me.id, name: me.name });
    const res = await fetch(`/api/room?${q}`);
    if (!res.ok) return;
    const next = (await res.json()) as Room;
    setRoom(next);
  }

  async function action(type: string, extra: Record<string, string> = {}) {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id: me.id, name: me.name, ...extra }),
    });
    if (res.ok) setRoom((await res.json()) as Room);
  }

  useEffect(() => {
    bootTelegram();
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
    if (!el || !joined || !room?.current) return;
    if (el.src !== new URL(room.current.url, window.location.origin).href) {
      el.src = room.current.url;
    }
    const want = positionOf(room);
    if (Math.abs(el.currentTime - want) > 0.8) el.currentTime = want;
    if (room.paused) void el.pause();
    else void el.play().catch(() => undefined);
  }, [joined, room]);

  async function onUpload(file: File) {
    setError("");
    const q = new URLSearchParams({
      title: file.name.replace(/\.[^.]+$/, ""),
      name: me.name,
      id: me.id,
    });
    const res = await fetch(`/api/upload?${q}`, { method: "POST", body: file });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not add that track");
      return;
    }
    setRoom(data);
    setTab("queue");
  }

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        chatId,
        appUrl: window.location.origin,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not reach that bot");
      return;
    }
    setOk("Posted to the group. Menu button is Jukebox.");
    void refresh();
  }

  const duration = room?.current?.duration || audioRef.current?.duration || 16;
  const pct = duration > 0 ? Math.min(100, (pos / duration) * 100) : 0;
  const isHost = room?.hostId === me.id || !room?.hostId;

  if (!joined) {
    return (
      <div className="app">
        <div className="brand">
          <img src="https://memetorrent.futuret3ch.com.au/logo.png" alt="MemeTorrent" />
          <p className="kicker">MemeTorrent</p>
        </div>
        <h1>Jukebox</h1>
        <p style={{ color: "var(--fg-muted)" }}>
          One room. One queue. Everyone in the group hears the same track.
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
        <img src="/logo.png" alt="MemeTorrent" />
        <p className="kicker">MemeTorrent · live</p>
      </div>
      <h1>Jukebox</h1>
      <div className="disc-wrap">
        <div className={room?.current && !room.paused ? "disc spin" : "disc"}>
          <img src="https://memetorrent.futuret3ch.com.au/logo.png" alt="" />
        </div>
      </div>
      <div className="now">
        <h2>{room?.current?.title ?? "Nothing on"}</h2>
        <p>
          {room?.current
            ? `${room.current.artist} · added by ${room.current.addedBy}`
            : "Queue a track from the library"}
        </p>
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
          Queue
        </button>
        <button type="button" className={tab === "connect" ? "on" : ""} onClick={() => setTab("connect")}>
          Connect bot
        </button>
      </div>
      {tab === "library" && (
        <div className="panel">
          <h3>Add to the room</h3>
          <button type="button" className="btn ghost" style={{ width: "100%", marginBottom: 8 }} onClick={() => fileRef.current?.click()}>
            Upload from this phone
          </button>
          <input
            ref={fileRef}
            className="hidden-file"
            type="file"
            accept="audio/*,.mp3,.m4a,.wav"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void onUpload(file);
            }}
          />
          {(room?.library ?? []).map((t) => (
            <div className="row" key={t.id}>
              <div>
                <strong>{t.title}</strong>
                <span>{t.artist}</span>
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
          {(room?.queue.length ?? 0) === 0 && <p className="hint">Empty. Queue something from the library.</p>}
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
      {tab === "connect" && (
        <form className="panel" onSubmit={(e) => void onConnect(e)}>
          <h3>Hook a bot to the group</h3>
          <p className="hint">
            Pick any of your bots. Paste the token from BotFather, then the group chat id. We set the menu
            button to Open jukebox and post in the group.
          </p>
          <label htmlFor="token">Bot token</label>
          <input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <label htmlFor="chat">Group chat id</label>
          <input
            id="chat"
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-100…"
          />
          <button type="submit" className="btn primary" style={{ width: "100%" }}>
            Connect this group
          </button>
          {error ? <p className="error">{error}</p> : null}
          {ok ? <p className="ok">{ok}</p> : null}
        </form>
      )}
      {error && tab !== "connect" ? <p className="error">{error}</p> : null}
      <audio ref={audioRef} playsInline />
    </div>
  );
}
