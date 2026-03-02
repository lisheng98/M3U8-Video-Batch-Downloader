#!/usr/bin/env python3
"""Simple GUI for parallel yt-dlp downloads."""

from __future__ import annotations

import os
import queue
import shlex
import shutil
import subprocess
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


class YtDlpBatchApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("M3U8 Video Batch Downloader")
        self.root.geometry("980x620")

        self.default_output_dir = str(Path.home() / "Downloads")
        self.output_dir_var = tk.StringVar(value=self.default_output_dir)
        self.workers_var = tk.IntVar(value=min(4, os.cpu_count() or 4))
        self.url_var = tk.StringVar()
        self.name_var = tk.StringVar()
        self.name_history: list[str] = []
        self.name_history_index: int | None = None

        self.events: queue.Queue[dict] = queue.Queue()
        self.remaining = 0
        self.active_items: set[str] = set()
        self.executor: ThreadPoolExecutor | None = None
        self.process_lock = threading.Lock()
        self.processes: dict[str, subprocess.Popen] = {}
        self.futures: dict[str, Future] = {}
        self.cancel_requested: set[str] = set()
        self.drag_select_active = False
        self.drag_start_row: str | None = None
        self.drag_additive = False
        self.drag_base_selection: set[str] = set()

        self._build_ui()
        self.root.after(100, self._process_events)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, padding=12)
        main.pack(fill=tk.BOTH, expand=True)

        folder_row = ttk.Frame(main)
        folder_row.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(folder_row, text="Output folder:").pack(side=tk.LEFT)
        ttk.Entry(folder_row, textvariable=self.output_dir_var).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=8
        )
        ttk.Button(folder_row, text="Browse", command=self._choose_output_dir).pack(side=tk.LEFT)

        input_row = ttk.Frame(main)
        input_row.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(input_row, text="Link (.m3u8):").pack(side=tk.LEFT)
        ttk.Entry(input_row, textvariable=self.url_var).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 10)
        )
        ttk.Label(input_row, text="Video name:").pack(side=tk.LEFT)
        self.name_entry = ttk.Entry(input_row, textvariable=self.name_var, width=30)
        self.name_entry.pack(side=tk.LEFT, padx=(8, 10))
        self.name_entry.bind("<Up>", self._on_name_up)
        self.name_entry.bind("<Down>", self._on_name_down)
        self.name_entry.bind("<KeyPress>", self._on_name_keypress)
        ttk.Button(input_row, text="Add", command=self._add_task).pack(side=tk.LEFT)

        self.root.bind("<Return>", lambda _e: self._add_task())

        table_wrap = ttk.Frame(main)
        table_wrap.pack(fill=tk.BOTH, expand=True)

        self.table = ttk.Treeview(
            table_wrap,
            columns=("url", "name", "status"),
            show="headings",
            height=12,
            selectmode="extended",
        )
        self.table.heading("url", text="Link")
        self.table.heading("name", text="Output name")
        self.table.heading("status", text="Status")
        # Keep manual user resizing stable; do not auto-stretch this column.
        self.table.column("url", width=560, stretch=False)
        self.table.column("name", width=220, stretch=False)
        self.table.column("status", width=150, stretch=False)
        self.table.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.table.bind("<Button-3>", self._show_table_menu)
        self.table.bind("<Button-2>", self._show_table_menu)
        self.table.bind("<Command-a>", self._select_all_rows)
        self.table.bind("<Control-a>", self._select_all_rows)
        self.table.bind("<Button-1>", self._on_table_left_down)
        self.table.bind("<Command-Button-1>", self._on_table_left_down_additive)
        self.table.bind("<Control-Button-1>", self._on_table_left_down_additive)
        self.table.bind("<B1-Motion>", self._on_table_drag_motion)
        self.table.bind("<ButtonRelease-1>", self._on_table_left_up)

        scrollbar = ttk.Scrollbar(table_wrap, orient=tk.VERTICAL, command=self.table.yview)
        self.table.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.table_menu = tk.Menu(self.root, tearoff=0)
        self.table_menu.add_command(label="Edit selected", command=self._edit_selected_task)
        self.table_menu.add_separator()
        self.table_menu.add_command(label="Remove selected", command=self._remove_selected)

        controls = ttk.Frame(main)
        controls.pack(fill=tk.X, pady=(8, 8))

        ttk.Label(controls, text="Parallel downloads:").pack(side=tk.LEFT)
        ttk.Spinbox(controls, from_=1, to=16, textvariable=self.workers_var, width=5).pack(
            side=tk.LEFT, padx=(8, 18)
        )
        ttk.Button(controls, text="Remove selected", command=self._remove_selected).pack(side=tk.LEFT)
        ttk.Button(controls, text="Clear done/failed", command=self._clear_finished).pack(
            side=tk.LEFT, padx=8
        )
        self.start_btn = ttk.Button(controls, text="Start downloads", command=self._start_downloads)
        self.start_btn.pack(side=tk.RIGHT)

        ttk.Label(main, text="Logs").pack(anchor=tk.W)
        self.log = tk.Text(main, height=12, wrap=tk.WORD, state=tk.DISABLED)
        self.log.pack(fill=tk.BOTH, expand=True)

    def _choose_output_dir(self) -> None:
        selected = filedialog.askdirectory(initialdir=self.output_dir_var.get())
        if selected:
            self.output_dir_var.set(selected)

    def _normalize_name(self, raw_name: str) -> str:
        name = raw_name.strip()
        if not name:
            return ""
        # Store names as stems; yt-dlp controls final extension.
        if name.lower().endswith(".mp4"):
            name = name[:-4]
        return name.strip()

    def _add_task(self) -> None:
        url = self.url_var.get().strip()
        name = self._normalize_name(self.name_var.get())
        if not url or not name:
            messagebox.showerror("Missing input", "Please provide both link and video name.")
            return

        self.table.insert("", tk.END, values=(url, name, "Queued"))
        self.name_history.append(name)
        self.name_history_index = None
        self.url_var.set("")
        self.name_var.set("")

    def _on_name_keypress(self, event: tk.Event) -> None:
        if event.keysym not in {"Up", "Down"}:
            self.name_history_index = None

    def _on_name_up(self, _event: tk.Event) -> str:
        if not self.name_history:
            return "break"
        if self.name_history_index is None:
            self.name_history_index = len(self.name_history) - 1
        elif self.name_history_index > 0:
            self.name_history_index -= 1
        self.name_var.set(self.name_history[self.name_history_index])
        self.name_entry.icursor(tk.END)
        return "break"

    def _on_name_down(self, _event: tk.Event) -> str:
        if not self.name_history:
            return "break"
        if self.name_history_index is None:
            return "break"
        if self.name_history_index < len(self.name_history) - 1:
            self.name_history_index += 1
            self.name_var.set(self.name_history[self.name_history_index])
        else:
            self.name_history_index = None
            self.name_var.set("")
        self.name_entry.icursor(tk.END)
        return "break"

    def _show_table_menu(self, event: tk.Event) -> str:
        row = self.table.identify_row(event.y)
        if row:
            if row not in self.table.selection():
                self.table.selection_set(row)
            self.table.focus(row)
            self.table_menu.tk_popup(event.x_root, event.y_root)
        return "break"

    def _select_all_rows(self, _event: tk.Event) -> str:
        items = self.table.get_children()
        if items:
            self.table.selection_set(items)
        return "break"

    def _items_between(self, first_item: str, last_item: str) -> list[str]:
        items = list(self.table.get_children())
        if first_item not in items or last_item not in items:
            return []
        first_idx = items.index(first_item)
        last_idx = items.index(last_item)
        if first_idx <= last_idx:
            return items[first_idx : last_idx + 1]
        return items[last_idx : first_idx + 1]

    def _row_from_y(self, y: int) -> str | None:
        row = self.table.identify_row(y)
        if row:
            return row
        items = self.table.get_children()
        if not items:
            return None
        return items[0] if y < 0 else items[-1]

    def _begin_drag_select(self, event: tk.Event, additive: bool) -> str | None:
        region = self.table.identify_region(event.x, event.y)
        if region not in {"cell", "tree"}:
            return None

        row = self._row_from_y(event.y)
        if row is None:
            return "break"

        self.drag_select_active = True
        self.drag_start_row = row
        self.drag_additive = additive
        self.drag_base_selection = set(self.table.selection()) if additive else set()
        self._apply_drag_selection(row)
        self.table.focus(row)
        return "break"

    def _apply_drag_selection(self, current_row: str) -> None:
        if self.drag_start_row is None:
            return
        drag_items = set(self._items_between(self.drag_start_row, current_row))
        if self.drag_additive:
            new_selection = list(self.drag_base_selection | drag_items)
        else:
            new_selection = list(drag_items)
        self.table.selection_set(new_selection)

    def _on_table_left_down(self, event: tk.Event) -> str | None:
        return self._begin_drag_select(event, additive=False)

    def _on_table_left_down_additive(self, event: tk.Event) -> str | None:
        return self._begin_drag_select(event, additive=True)

    def _on_table_drag_motion(self, event: tk.Event) -> str | None:
        if not self.drag_select_active:
            return None
        row = self._row_from_y(event.y)
        if row is None:
            return "break"
        self._apply_drag_selection(row)
        return "break"

    def _on_table_left_up(self, _event: tk.Event) -> str | None:
        if not self.drag_select_active:
            return None
        self.drag_select_active = False
        self.drag_start_row = None
        self.drag_base_selection = set()
        return "break"

    def _edit_selected_task(self) -> None:
        selected = self.table.selection()
        if not selected:
            return

        item = selected[0]
        status = self.table.set(item, "status")
        if status == "Running":
            messagebox.showwarning("Task running", "Cannot edit a task while it is running.")
            return

        edit_win = tk.Toplevel(self.root)
        edit_win.title("Edit download task")
        edit_win.transient(self.root)
        edit_win.grab_set()
        edit_win.resizable(False, False)

        url_var = tk.StringVar(value=self.table.set(item, "url"))
        name_var = tk.StringVar(value=self.table.set(item, "name"))

        frame = ttk.Frame(edit_win, padding=12)
        frame.pack(fill=tk.BOTH, expand=True)

        ttk.Label(frame, text="Link (.m3u8):").grid(row=0, column=0, sticky="w")
        url_entry = ttk.Entry(frame, textvariable=url_var, width=80)
        url_entry.grid(row=1, column=0, pady=(2, 10), sticky="ew")

        ttk.Label(frame, text="Video name:").grid(row=2, column=0, sticky="w")
        name_entry = ttk.Entry(frame, textvariable=name_var, width=80)
        name_entry.grid(row=3, column=0, pady=(2, 10), sticky="ew")

        btns = ttk.Frame(frame)
        btns.grid(row=4, column=0, sticky="e")

        def save() -> None:
            new_url = url_var.get().strip()
            new_name = self._normalize_name(name_var.get())
            if not new_url or not new_name:
                messagebox.showerror("Invalid input", "Link and video name are required.")
                return
            self.table.set(item, "url", new_url)
            self.table.set(item, "name", new_name)
            self.table.set(item, "status", "Queued")
            edit_win.destroy()

        ttk.Button(btns, text="Cancel", command=edit_win.destroy).pack(side=tk.RIGHT)
        ttk.Button(btns, text="Save", command=save).pack(side=tk.RIGHT, padx=(0, 8))

        url_entry.focus_set()

    def _remove_selected(self) -> None:
        selected = list(self.table.selection())
        if not selected:
            return

        for item in selected:
            self._cancel_task(item)

        for item in selected:
            if self.table.exists(item):
                self.table.delete(item)

    def _cancel_task(self, item: str) -> None:
        if not self.table.exists(item):
            return

        name = self.table.set(item, "name")
        status = self.table.set(item, "status")
        if status not in {"Queued", "Failed", "Running"}:
            return

        future_cancelled = False
        proc: subprocess.Popen | None = None
        with self.process_lock:
            self.cancel_requested.add(item)
            future = self.futures.get(item)
            if future is not None:
                future_cancelled = future.cancel()
            proc = self.processes.get(item)

        if future_cancelled:
            self.events.put({"type": "log", "text": f"[{name}] Cancelled before start.\n"})
            self.events.put({"type": "status", "item": item, "status": "Cancelled"})
            return

        if proc is not None and proc.poll() is None:
            proc.terminate()
            self.events.put({"type": "log", "text": f"[{name}] Stop requested.\n"})

    def _clear_finished(self) -> None:
        for item in self.table.get_children():
            status = self.table.set(item, "status")
            if status in {"Completed", "Failed", "Cancelled"}:
                self.table.delete(item)

    def _start_downloads(self) -> None:
        if shutil.which("yt-dlp") is None:
            messagebox.showerror("yt-dlp not found", "Install yt-dlp first. Example: brew install yt-dlp")
            return

        output_dir = Path(self.output_dir_var.get()).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        pending = []
        for item in self.table.get_children():
            status = self.table.set(item, "status")
            if status in {"Queued", "Failed"}:
                pending.append(item)

        if not pending:
            messagebox.showinfo("Nothing to do", "No queued downloads found.")
            return

        workers = max(1, min(16, int(self.workers_var.get())))
        self.remaining = len(pending)
        self.active_items = set(pending)
        self.start_btn.config(state=tk.DISABLED)
        self._append_log(f"Starting {self.remaining} download(s) with {workers} parallel worker(s).\n")

        self.executor = ThreadPoolExecutor(max_workers=workers)
        for item in pending:
            url = self.table.set(item, "url")
            name = self.table.set(item, "name")
            self.table.set(item, "status", "Running")
            with self.process_lock:
                self.cancel_requested.discard(item)
            future = self.executor.submit(self._download_one, item, url, name, output_dir)
            with self.process_lock:
                self.futures[item] = future

    def _download_one(self, item: str, url: str, name: str, output_dir: Path) -> None:
        with self.process_lock:
            if item in self.cancel_requested:
                self.events.put({"type": "status", "item": item, "status": "Cancelled"})
                return

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
        self.events.put({"type": "log", "text": f"\n[{name}] {cmd_text}\n"})

        proc: subprocess.Popen | None = None
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            with self.process_lock:
                self.processes[item] = proc
                should_cancel = item in self.cancel_requested
            if should_cancel and proc.poll() is None:
                proc.terminate()

            assert proc.stdout is not None
            for line in proc.stdout:
                self.events.put({"type": "log", "text": f"[{name}] {line}"})
            code = proc.wait()
            with self.process_lock:
                was_cancelled = item in self.cancel_requested
            status = "Cancelled" if was_cancelled else ("Completed" if code == 0 else "Failed")
            self.events.put({"type": "status", "item": item, "status": status})
        except Exception as exc:  # pragma: no cover - defensive
            self.events.put({"type": "log", "text": f"[{name}] Error: {exc}\n"})
            with self.process_lock:
                was_cancelled = item in self.cancel_requested
            self.events.put({"type": "status", "item": item, "status": "Cancelled" if was_cancelled else "Failed"})
        finally:
            with self.process_lock:
                self.processes.pop(item, None)

    def _process_events(self) -> None:
        try:
            while True:
                event = self.events.get_nowait()
                if event["type"] == "log":
                    self._append_log(event["text"])
                elif event["type"] == "status":
                    item = event["item"]
                    with self.process_lock:
                        self.futures.pop(item, None)
                        self.cancel_requested.discard(item)

                    if self.table.exists(item):
                        self.table.set(item, "status", event["status"])
                    if item in self.active_items:
                        self.active_items.remove(item)
                        self.remaining = len(self.active_items)
                    if self.remaining == 0 and self.start_btn.instate(("disabled",)):
                        self.start_btn.config(state=tk.NORMAL)
                        self._append_log("\nAll downloads finished.\n")
                        if self.executor is not None:
                            self.executor.shutdown(wait=False)
                            self.executor = None
        except queue.Empty:
            pass
        self.root.after(100, self._process_events)

    def _append_log(self, text: str) -> None:
        self.log.configure(state=tk.NORMAL)
        self.log.insert(tk.END, text)
        self.log.see(tk.END)
        self.log.configure(state=tk.DISABLED)

    def _on_close(self) -> None:
        with self.process_lock:
            running_procs = list(self.processes.values())
            self.cancel_requested.update(self.processes.keys())
        for proc in running_procs:
            if proc.poll() is None:
                proc.terminate()
        if self.executor is not None:
            self.executor.shutdown(wait=False)
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    app = YtDlpBatchApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
