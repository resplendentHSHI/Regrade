import { invoke } from "@tauri-apps/api/core";
import { getAuthTokens, saveAuthTokens, clearAuthTokens } from "./store";

// Loaded from environment at build time via Vite's define
const GOOGLE_CLIENT_ID = __GOOGLE_CLIENT_ID__;
const GOOGLE_CLIENT_SECRET = __GOOGLE_CLIENT_SECRET__;
const REDIRECT_URI = "http://localhost:9876/callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// ── Token storage ────────────────────────────────────────────────────────
// Tokens live in TWO places:
//   1. localStorage (fast synchronous reads, used by App.tsx on mount)
//   2. tokens.json via @tauri-apps/plugin-fs (durable across restarts)
//
// localStorage can be wiped by WebKit on app updates or cache clears.
// tokens.json survives anything short of the user explicitly signing out.
// On app startup, hydrateTokensFromStore() copies from (2) → (1).

export function getStoredToken(): string | null {
  return localStorage.getItem("poko_auth_token");
}

export function storeToken(token: string): void {
  localStorage.setItem("poko_auth_token", token);
}

function storeRefreshToken(refreshToken: string): void {
  localStorage.setItem("poko_refresh_token", refreshToken);
}

export function clearToken(): void {
  localStorage.removeItem("poko_auth_token");
  localStorage.removeItem("poko_refresh_token");
  clearAuthTokens().catch(() => {});
}

export function isAuthenticated(): boolean {
  return getStoredToken() !== null;
}

/**
 * Called once on app startup (before React renders). If localStorage was
 * cleared but the durable file store still has tokens, restore them so
 * the user doesn't have to sign in again.
 */
export async function hydrateTokensFromStore(): Promise<void> {
  // Already have a token in localStorage — nothing to restore.
  if (getStoredToken()) return;

  const saved = await getAuthTokens();
  if (saved?.accessToken) {
    storeToken(saved.accessToken);
    if (saved.refreshToken) {
      storeRefreshToken(saved.refreshToken);
    }
  }
}

// ── Sign in ──────────────────────────────────────────────────────────────

export async function signIn(): Promise<string> {
  const existing = getStoredToken();
  if (existing && existing !== "dev-token-placeholder") {
    return existing;
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "email",
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  const code = await startCallbackServerAndAuth(authUrl);

  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokens = await tokenResp.json();
  const accessToken = tokens.access_token as string;

  // Write to both localStorage (fast) and durable file store (persistent)
  storeToken(accessToken);
  const authData: { accessToken: string; refreshToken?: string } = { accessToken };
  if (tokens.refresh_token) {
    storeRefreshToken(tokens.refresh_token);
    authData.refreshToken = tokens.refresh_token;
  }
  await saveAuthTokens(authData);

  return accessToken;
}

async function startCallbackServerAndAuth(authUrl: string): Promise<string> {
  return invoke<string>("start_oauth_flow", { authUrl });
}

// ── Token refresh ────────────────────────────────────────────────────────

export async function refreshAccessToken(): Promise<string | null> {
  // Try localStorage first, fall back to durable store
  let refreshToken = localStorage.getItem("poko_refresh_token");
  if (!refreshToken) {
    const saved = await getAuthTokens();
    refreshToken = saved?.refreshToken ?? null;
  }
  if (!refreshToken) return null;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) return null;

  const tokens = await resp.json();
  const accessToken = tokens.access_token as string;

  // Persist the new access token to both stores
  storeToken(accessToken);
  await saveAuthTokens({ accessToken, refreshToken });

  return accessToken;
}

// ── Sign out ─────────────────────────────────────────────────────────────

export function signOut(): void {
  clearToken();
  window.location.reload();
}
