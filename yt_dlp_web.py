#!/usr/bin/env python3
"""Localhost web UI for parallel yt-dlp downloads."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import threading
import uuid
import webbrowser
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_name(raw_name: str) -> str:
    name = raw_name.strip()
    if name.lower().endswith(".mp4"):
        name = name[:-4]
    return name.strip()


@dataclass
class Task:
    id: str
    url: str
    name: str
    status: str = "Queued"
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "name": self.name,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class DownloadManager:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.tasks: dict[str, Task] = {}
        self.task_order: list[str] = []
        self.logs: list[dict] = []
        self.log_seq = 0
        self.running = False

        self.executor: ThreadPoolExecutor | None = None
        self.futures: dict[str, Future] = {}
        self.processes: dict[str, subprocess.Popen] = {}
        self.active_run: set[str] = set()
        self.cancel_requested: set[str] = set()

    def _log_locked(self, text: str) -> None:
        self.log_seq += 1
        self.logs.append({"seq": self.log_seq, "text": text})
        if len(self.logs) > 6000:
            self.logs = self.logs[-6000:]

    def log(self, text: str) -> None:
        with self.lock:
            self._log_locked(text)

    def list_tasks(self) -> list[dict]:
        with self.lock:
            return [self.tasks[task_id].to_json() for task_id in self.task_order if task_id in self.tasks]

    def get_state(self) -> dict:
        with self.lock:
            running = self.running
        return {
            "tasks": self.list_tasks(),
            "running": running,
            "yt_dlp_found": shutil.which("yt-dlp") is not None,
            "default_output_dir": DEFAULT_OUTPUT_DIR,
        }

    def logs_since(self, since_seq: int) -> dict:
        with self.lock:
            rows = [row for row in self.logs if row["seq"] > since_seq]
            return {"rows": rows, "last_seq": self.log_seq}

    def add_task(self, url: str, name: str) -> dict:
        url = url.strip()
        name = normalize_name(name)
        if not url or not name:
            raise ValueError("Link and video name are required.")

        task_id = uuid.uuid4().hex[:10]
        task = Task(id=task_id, url=url, name=name)
        with self.lock:
            self.tasks[task_id] = task
            self.task_order.append(task_id)
        return task.to_json()

    def edit_task(self, task_id: str, url: str, name: str) -> dict:
        url = url.strip()
        name = normalize_name(name)
        if not url or not name:
            raise ValueError("Link and video name are required.")

        with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                raise KeyError("Task not found.")
            if task.status == "Running":
                raise RuntimeError("Cannot edit a running task.")
            task.url = url
            task.name = name
            task.status = "Queued"
            task.updated_at = utc_now_iso()
            return task.to_json()

    def remove_tasks(self, task_ids: list[str]) -> int:
        removed_ids: set[str] = set()
        with self.lock:
            for task_id in task_ids:
                task = self.tasks.get(task_id)
                if task is None:
                    continue

                removed_ids.add(task_id)
                self.cancel_requested.add(task_id)
                future = self.futures.get(task_id)
                if future is not None and future.cancel():
                    self.futures.pop(task_id, None)
                    self.active_run.discard(task_id)

                proc = self.processes.get(task_id)
                if proc is not None and proc.poll() is None:
                    proc.terminate()
                    self._log_locked(f"[{task.name}] Stop requested.\n")

                self.tasks.pop(task_id, None)

            if removed_ids:
                self.task_order = [task_id for task_id in self.task_order if task_id not in removed_ids]
                self._maybe_finish_run_locked()

        return len(removed_ids)

    def clear_finished(self) -> int:
        done = {"Completed", "Failed", "Cancelled"}
        with self.lock:
            removable = [task_id for task_id in self.task_order if self.tasks.get(task_id) and self.tasks[task_id].status in done]
            for task_id in removable:
                self.tasks.pop(task_id, None)
            if removable:
                remove_set = set(removable)
                self.task_order = [task_id for task_id in self.task_order if task_id not in remove_set]
            return len(removable)

    def clear_logs(self) -> None:
        with self.lock:
            self.logs = []
            self.log_seq = 0

    def start_downloads(self, output_dir: str, workers: int) -> int:
        if shutil.which("yt-dlp") is None:
            raise RuntimeError("yt-dlp not found. Install it first (example: brew install yt-dlp).")

        workers = max(1, min(16, int(workers)))
        out_dir = Path(output_dir).expanduser().resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        with self.lock:
            if self.running:
                raise RuntimeError("Downloads are already running.")

            pending = [
                task_id
                for task_id in self.task_order
                if task_id in self.tasks and self.tasks[task_id].status in {"Queued", "Failed"}
            ]
            if not pending:
                self._log_locked("No queued downloads found.\n")
                return 0

            self.running = True
            self.active_run = set(pending)
            self.executor = ThreadPoolExecutor(max_workers=workers)
            self._log_locked(f"Starting {len(pending)} download(s) with {workers} parallel worker(s).\n")

            for task_id in pending:
                task = self.tasks.get(task_id)
                if task is None:
                    continue
                task.status = "Running"
                task.updated_at = utc_now_iso()
                self.cancel_requested.discard(task_id)
                future = self.executor.submit(self._run_one, task_id, out_dir)
                self.futures[task_id] = future

            return len(pending)

    def _run_one(self, task_id: str, output_dir: Path) -> None:
        final_status = "Failed"
        proc: subprocess.Popen | None = None

        with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                self.active_run.discard(task_id)
                self.futures.pop(task_id, None)
                self._maybe_finish_run_locked()
                return
            if task_id in self.cancel_requested:
                final_status = "Cancelled"
                task.status = final_status
                task.updated_at = utc_now_iso()
                self.active_run.discard(task_id)
                self.futures.pop(task_id, None)
                self._maybe_finish_run_locked()
                return
            url = task.url
            name = task.name

        output_template = str(output_dir / f"{name}.%(ext)s")
        cmd = [
            "yt-dlp",
            url,
            "-o",
            output_template,
            "--merge-output-format",
            "mp4",
        ]
        cmd_text = " ".join(shlex.quote(part) for part in cmd)
        self.log(f"\n[{name}] {cmd_text}\n")

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            with self.lock:
                self.processes[task_id] = proc
                should_cancel = task_id in self.cancel_requested

            if should_cancel and proc.poll() is None:
                proc.terminate()

            assert proc.stdout is not None
            for line in proc.stdout:
                self.log(f"[{name}] {line}")

            code = proc.wait()
            with self.lock:
                was_cancelled = task_id in self.cancel_requested
            final_status = "Cancelled" if was_cancelled else ("Completed" if code == 0 else "Failed")
        except Exception as exc:  # pragma: no cover - defensive
            self.log(f"[{name}] Error: {exc}\n")
            with self.lock:
                was_cancelled = task_id in self.cancel_requested
            final_status = "Cancelled" if was_cancelled else "Failed"
        finally:
            with self.lock:
                self.processes.pop(task_id, None)
                self.futures.pop(task_id, None)
                task = self.tasks.get(task_id)
                if task is not None:
                    task.status = final_status
                    task.updated_at = utc_now_iso()
                self.active_run.discard(task_id)
                self._maybe_finish_run_locked()

    def _maybe_finish_run_locked(self) -> None:
        if self.running and not self.active_run:
            self.running = False
            self._log_locked("\nAll downloads finished.\n")
            executor = self.executor
            self.executor = None
            if executor is not None:
                threading.Thread(target=executor.shutdown, kwargs={"wait": False}, daemon=True).start()

    def stop_all(self) -> int:
        with self.lock:
            target_ids = list(self.active_run)
        return self.remove_tasks(target_ids)


MANAGER = DownloadManager()
BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DEFAULT_OUTPUT_DIR = str(Path.home() / "Downloads")


class AppHandler(BaseHTTPRequestHandler):
    server_version = "m3u8-video-web/1.0"

    def log_message(self, format: str, *args: object) -> None:
        return

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_text(self, text: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST) -> None:
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _serve_file(self, filename: str, content_type: str) -> None:
        path = WEB_DIR / filename
        if not path.exists():
            self._send_text("Not found", HTTPStatus.NOT_FOUND)
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/":
            self._serve_file("index.html", "text/html; charset=utf-8")
            return
        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/app.js":
            self._serve_file("app.js", "application/javascript; charset=utf-8")
            return
        if path == "/styles.css":
            self._serve_file("styles.css", "text/css; charset=utf-8")
            return
        if path == "/api/state":
            self._send_json(MANAGER.get_state())
            return
        if path == "/api/logs":
            query = parse_qs(parsed.query)
            try:
                since = int(query.get("since", ["0"])[0])
            except (TypeError, ValueError):
                since = 0
            self._send_json(MANAGER.logs_since(since))
            return
        self._send_text("Not found", HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            payload = self._read_json()
            if path == "/api/tasks":
                task = MANAGER.add_task(payload.get("url", ""), payload.get("name", ""))
                self._send_json({"task": task}, HTTPStatus.CREATED)
                return
            if path == "/api/remove":
                ids = payload.get("ids", [])
                if not isinstance(ids, list):
                    raise ValueError("ids must be a list.")
                removed = MANAGER.remove_tasks([str(task_id) for task_id in ids])
                self._send_json({"removed": removed})
                return
            if path == "/api/clear-finished":
                removed = MANAGER.clear_finished()
                self._send_json({"removed": removed})
                return
            if path in {"/api/logs/clear", "/api/clear-logs"}:
                MANAGER.clear_logs()
                self._send_json({"ok": True})
                return
            if path == "/api/start":
                output_dir = str(payload.get("output_dir", "")).strip() or DEFAULT_OUTPUT_DIR
                workers = int(payload.get("workers", min(4, os.cpu_count() or 4)))
                count = MANAGER.start_downloads(output_dir=output_dir, workers=workers)
                self._send_json({"started": count})
                return
            if path == "/api/stop-all":
                removed = MANAGER.stop_all()
                self._send_json({"stopped": removed})
                return
            self._send_text("Not found", HTTPStatus.NOT_FOUND)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body."}, HTTPStatus.BAD_REQUEST)
        except KeyError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except Exception as exc:  # pragma: no cover - defensive
            self._send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PATCH(self) -> None:  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/tasks/"):
            self._send_text("Not found", HTTPStatus.NOT_FOUND)
            return

        task_id = path.rsplit("/", 1)[-1]
        try:
            payload = self._read_json()
            task = MANAGER.edit_task(task_id, payload.get("url", ""), payload.get("name", ""))
            self._send_json({"task": task})
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body."}, HTTPStatus.BAD_REQUEST)
        except KeyError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except Exception as exc:  # pragma: no cover - defensive
            self._send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run localhost yt-dlp web UI.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", default=8765, type=int, help="Port to bind (default: 8765)")
    parser.add_argument("--open-browser", action="store_true", help="Open the browser automatically")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"Server running at {url}")
    if args.open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
