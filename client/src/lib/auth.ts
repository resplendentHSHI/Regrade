const DEV_TOKEN = "dev-token-placeholder";

export function getStoredToken(): string | null {
  return localStorage.getItem("poko_auth_token");
}

export function storeToken(token: string): void {
  localStorage.setItem("poko_auth_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("poko_auth_token");
}

export function isAuthenticated(): boolean {
  return getStoredToken() !== null;
}

export async function signIn(): Promise<string> {
  // TODO: Replace with real Google OAuth flow when Cloud credentials are set up
  // For dev: auto-generate a dev token
  const token = DEV_TOKEN;
  storeToken(token);
  return token;
}

export function signOut(): void {
  clearToken();
  window.location.reload();
}
