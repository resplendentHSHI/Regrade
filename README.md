# Poko — Your Grade Companion

Poko is a macOS app that pulls your graded Gradescope assignments, analyzes them with AI for possible grading mistakes, and drafts paste-ready regrade requests. It comes with your own ASCII art pet 🥚

**Poko never auto-submits regrade requests.** It only drafts them for you to review and send.

## ⬇️ Download for Mac

**[Download Poko for macOS (latest)](https://github.com/resplendentHSHI/Regrade/releases/download/latest-mac/Poko-mac.dmg)**

This link always serves the most recent build from the main development branch. Just open the `.dmg`, drag **Poko** to your Applications folder, and launch.

> On first open, macOS may ask you to allow the app (System Settings → Privacy & Security → "Open Anyway"). We're working on code-signing to remove this step.

### What you need
- A Mac running macOS 12 or later (Intel or Apple Silicon)
- A Google account (for sign-in)
- A Gradescope account with a direct password (not SSO-only)

---

## For developers — the personal regrade bot

This repo also contains the original personal Python bot that predates Poko. Docs below are for running that directly.

## Setup

1. Install dependencies:
   ```bash
   pip install -e ".[dev]"
   ```
2. Make sure `claude` (Claude Code CLI) is on your PATH:
   ```bash
   which claude && claude --version
   ```
3. Copy `.env.example` to `.env` and fill in your Gradescope credentials:
   ```bash
   cp .env.example .env
   $EDITOR .env
   ```
4. (Optional) Run unit tests:
   ```bash
   PYTHONPATH=. python -m pytest
   ```

## Running

The bot has two processes. They share the `data/` directory on disk.

### Heartbeat daemon (always running)

Runs in the foreground, sleeps until 2 AM local time each day, fetches new graded submissions, and analyzes them with Claude Code.

```bash
python -m gradescope_bot.heartbeat
```

Or run a one-shot cycle (used for the initial 7-day backfill and manual runs):

```bash
python -m gradescope_bot.heartbeat --run-now
```

### Web dashboard (ad-hoc)

Start it when you want to look at the queue. Kill it when you're done.

```bash
uvicorn gradescope_bot.serve:app --host 127.0.0.1 --port 8765
```

Then visit [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Manual QA checklist

Run through this after initial setup to verify the full pipeline:

1. `cp .env.example .env` and fill in credentials.
2. `python -m gradescope_bot.heartbeat --run-now`
3. Check `data/heartbeat.log` for a clean cycle.
4. Verify at least one folder exists under `data/queue/`.
5. `xdg-open data/queue/<first-item-id>/submission.pdf` — confirm PDF opens.
6. Check that `analysis.json` exists in the queue folder.
7. Start the server: `uvicorn gradescope_bot.serve:app --host 127.0.0.1 --port 8765`.
8. Visit `http://127.0.0.1:8765/`, verify items render, grouped by status.
9. Click into an item, verify the PDF iframe loads and the draft (if any) renders.
10. Click "Mark as reviewed" and verify the item moves to the Reviewed section.
11. Stop the server (Ctrl-C). Start the daemon: `python -m gradescope_bot.heartbeat`. Check the log shows the next wake time.

## Cost expectations

Based on smoke tests on 3 real graded PDFs (10, 12, 24 pages):

- Per-item analyzer cost: $0.93 – $1.73 (average ~$1.20)
- Daily steady-state (1-3 new items): $1-5/day
- Initial 7-day backfill (~20 items): one-time ~$25-30

## How it works

See the full design spec at `docs/superpowers/specs/2026-04-13-gradescope-regrade-bot-design.md` and the implementation plan at `docs/superpowers/plans/2026-04-13-gradescope-regrade-bot.md`.
