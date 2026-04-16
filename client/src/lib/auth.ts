import { invoke } from "@tauri-apps/api/core";

// Loaded from environment at build time via Vite's define
const GOOGLE_CLIENT_ID = __GOOGLE_CLIENT_ID__;
const GOOGLE_CLIENT_SECRET = __GOOGLE_CLIENT_SECRET__;
const REDIRECT_URI = "http://localhost:9876/callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function getStoredToken(): string | null {
  return localStorage.getItem("poko_auth_token");
}

export function storeToken(token: string): void {
  localStorage.setItem("poko_auth_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("poko_auth_token");
  localStorage.removeItem("poko_refresh_token");
}

export function isAuthenticated(): boolean {
  return getStoredToken() !== null;
}

export async function signIn(): Promise<string> {
  // Check for existing valid token
  const existing = getStoredToken();
  if (existing && existing !== "dev-token-placeholder") {
    return existing;
  }

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "email",
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  // Start local callback server and open browser
  const code = await startCallbackServerAndAuth(authUrl);

  // Exchange code for tokens
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

  storeToken(accessToken);
  if (tokens.refresh_token) {
    localStorage.setItem("poko_refresh_token", tokens.refresh_token);
  }

  return accessToken;
}

async function startCallbackServerAndAuth(authUrl: string): Promise<string> {
  // Use a Tauri command to start a tiny HTTP server on port 9876
  // that waits for the OAuth callback and returns the code.
  // We'll implement this as a Rust command.
  //
  // For now, use a simpler approach: open the browser and poll
  // a Rust-side callback listener.

  return invoke<string>("start_oauth_flow", { authUrl });
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("poko_refresh_token");
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
  storeToken(accessToken);
  return accessToken;
}

export function signOut(): void {
  clearToken();
  window.location.reload();
}
