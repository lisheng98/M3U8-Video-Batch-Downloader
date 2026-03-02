# M3U8 Video Batch Downloader (Local)

Batch download `.m3u8` links with `yt-dlp` using either:
- a localhost web UI (`yt_dlp_web.py`)
- a desktop Tkinter app (`yt_dlp_batch_gui.py`)

## Features

- Queue multiple links with custom output names
- Run downloads in parallel (1 to 16 workers)
- Choose output format (`mp4`, `mkv`, `webm`, `mov`, or `original`)
- Edit/remove queued items
- Stop running tasks
- Stream live logs
- Optional container remux to selected format when supported

## Requirements

- macOS
- Python 3
- `yt-dlp`
- `ffmpeg` (required by `yt-dlp` for merging/remuxing)

Install dependencies (Homebrew):

```bash
brew install yt-dlp ffmpeg
```

## Quick start (web UI)

From this project folder:

```bash
python3 yt_dlp_web.py --open-browser
```

Open:

```text
http://127.0.0.1:8765
```

## Quick start (desktop UI)

```bash
python3 yt_dlp_batch_gui.py
```

## Usage

1. Set output folder (default is `~/Downloads`).
2. Add `Link (.m3u8)` and `Video name`.
3. Choose `Parallel downloads` and `Output format`.
4. Click `Start downloads`.

Equivalent command per task:

```bash
yt-dlp "LINK" -o "VIDEO_NAME.%(ext)s" --merge-output-format FORMAT --remux-video FORMAT
```

## Privacy and safety notes

- The web server binds to `127.0.0.1` by default (local machine only).
- Do not use `--host 0.0.0.0` unless you intentionally want network access.
- Before publishing, keep local artifacts out of git (`.playwright-cli/`, `__pycache__/`, `*.pyc`).
