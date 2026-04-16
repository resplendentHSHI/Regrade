/**
 * Update check: compares the build's commit SHA (baked in at build time)
 * against the latest published release on GitHub. If they differ, we show
 * an "Update available" banner.
 */

// Baked in at build time via Vite define
declare const __BUILD_COMMIT__: string;

const GITHUB_API =
  "https://api.github.com/repos/resplendentHSHI/Regrade/releases/tags/latest-mac";
const DOWNLOAD_URL =
  "https://github.com/resplendentHSHI/Regrade/releases/download/latest-mac/Poko-mac.dmg";

export interface UpdateInfo {
  available: boolean;
  currentCommit: string;
  latestCommit: string | null;
  publishedAt: string | null;
  downloadUrl: string;
}

/** Fetch the latest release metadata and compare against this build. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current =
    typeof __BUILD_COMMIT__ !== "undefined" ? __BUILD_COMMIT__ : "";
  try {
    const resp = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) {
      return {
        available: false,
        currentCommit: current,
        latestCommit: null,
        publishedAt: null,
        downloadUrl: DOWNLOAD_URL,
      };
    }
    const data = await resp.json();
    // Extract commit SHA from release body: "@ <7-char SHA>" pattern
    const body: string = data.body || "";
    const match = body.match(/@ ([0-9a-f]{7,40})/);
    const latest = match ? match[1] : null;
    const publishedAt: string = data.published_at || null;

    const available =
      !!current &&
      !!latest &&
      !current.startsWith(latest) &&
      !latest.startsWith(current);

    return {
      available,
      currentCommit: current,
      latestCommit: latest,
      publishedAt,
      downloadUrl: DOWNLOAD_URL,
    };
  } catch {
    return {
      available: false,
      currentCommit: current,
      latestCommit: null,
      publishedAt: null,
      downloadUrl: DOWNLOAD_URL,
    };
  }
}
