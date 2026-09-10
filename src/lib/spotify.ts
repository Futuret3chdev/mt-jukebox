const REDIRECT = "https://mt-house-jukebox.vercel.app/";
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

function clientId() {
  return localStorage.getItem("sp-client") || "";
}

export function setSpotifyClientId(id: string) {
  localStorage.setItem("sp-client", id.trim());
}

export function getSpotifyClientId() {
  return clientId();
}

export function spotifyToken() {
  const raw = localStorage.getItem("sp-token");
  if (!raw) return "";
  const parsed = JSON.parse(raw) as { access: string; exp: number };
  if (Date.now() > parsed.exp) {
    localStorage.removeItem("sp-token");
    return "";
  }
  return parsed.access;
}

async function sha256(plain: string) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function startSpotifyLogin() {
  const id = clientId();
  if (!id) throw new Error("Paste your Spotify Client ID first");
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  localStorage.setItem("sp-verifier", verifier);
  const challenge = await sha256(verifier);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", id);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  window.location.href = url.toString();
}

export async function finishSpotifyLogin() {
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) return false;
  const verifier = localStorage.getItem("sp-verifier");
  const id = clientId();
  if (!verifier || !id) return false;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: id,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  history.replaceState({}, "", "/");
  if (!data.access_token) return false;
  localStorage.setItem(
    "sp-token",
    JSON.stringify({ access: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 - 30_000 }),
  );
  return true;
}

export async function searchTracks(q: string) {
  const token = spotifyToken();
  if (!token) throw new Error("Connect Spotify first");
  const res = await fetch(
    `https://api.spotify.com/v1/search?type=track&limit=10&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await res.json()) as {
    tracks?: { items: { id: string; name: string; uri: string; duration_ms: number; artists: { name: string }[] }[] };
  };
  return data.tracks?.items ?? [];
}
