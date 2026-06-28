#!/usr/bin/env python3

import json
import os
import re
import sys
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path


APP_NAME = "{{ app_name }}"
WINDOW_TITLE = "{{ window_title }}"
FRONTEND_DIST = "{{ frontend_dist }}"


@dataclass
class Element:
    tag: str
    attrs: dict[str, str]
    text: str = ""


@dataclass
class Document:
    elements: list[Element] = field(default_factory=list)
    scripts: list[str] = field(default_factory=list)


class HtmlToTkParser(HTMLParser):
    text_tags = {
        "main",
        "section",
        "header",
        "nav",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "div",
        "span",
        "label",
        "button",
    }

    def __init__(self) -> None:
        super().__init__()
        self.document = Document()
        self._stack: list[Element] = []
        self._script_depth = 0
        self._script_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "script":
            self._script_depth += 1
            self._script_chunks = []
            return
        if tag in self.text_tags:
            self._stack.append(Element(tag, {name.lower(): value or "" for name, value in attrs}))

    def handle_data(self, data: str) -> None:
        if self._script_depth:
            self._script_chunks.append(data)
        elif self._stack:
            self._stack[-1].text += data

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "script" and self._script_depth:
            self._script_depth -= 1
            self.document.scripts.append("".join(self._script_chunks))
            self._script_chunks = []
            return
        if self._stack and self._stack[-1].tag == tag:
            element = self._stack.pop()
            element.text = " ".join(element.text.split())
            if element.text or element.tag == "button" or "id" in element.attrs or "class" in element.attrs:
                self.document.elements.append(element)


class MiniJsRuntime:
    def __init__(self, document: Document, storage_path: Path) -> None:
        self.document = document
        self.storage_path = storage_path
        self.storage = self._load_storage()
        self.variables: dict[str, object] = {}
        self.functions = self._parse_functions()
        self.element_text: dict[str, str] = {
            element.attrs["id"]: element.text for element in document.elements if "id" in element.attrs
        }
        self._parse_globals()
        self._run_top_level()

    def _load_storage(self) -> dict[str, str]:
        if not self.storage_path.exists():
            return {}
        try:
            return json.loads(self.storage_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_storage(self) -> None:
        self.storage_path.write_text(json.dumps(self.storage, indent=2, sort_keys=True), encoding="utf-8")

    def _parse_functions(self) -> dict[str, str]:
        scripts = "\n".join(self.document.scripts)
        functions: dict[str, str] = {}
        for match in re.finditer(r"function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", scripts):
            name = match.group(1)
            body_start = match.end()
            depth = 1
            offset = body_start
            while offset < len(scripts) and depth:
                char = scripts[offset]
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                offset += 1
            functions[name] = scripts[body_start : offset - 1]
        return functions

    def _parse_globals(self) -> None:
        scripts = self._top_level_script()
        for name, value in re.findall(r"(?:let|var|const)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);", scripts):
            self.variables[name] = self._eval_expression(value)

    def _run_top_level(self) -> None:
        for statement in self._split_statements(self._top_level_script()):
            self._execute_statement(statement)

    def _top_level_script(self) -> str:
        scripts = "\n".join(self.document.scripts)
        scripts = re.sub(r"function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{.*?\}", "", scripts, flags=re.S)
        return re.sub(r"//.*", "", scripts)

    def click(self, button_name: str) -> None:
        normalized = button_name.strip().lower()
        for element in self.document.elements:
            if element.tag != "button":
                continue
            action = element.attrs.get("onclick", "").strip()
            text = element.text.strip().lower()
            if action.rstrip("();").lower() == normalized or text == normalized:
                self.call(action.rstrip("();"))
                return
        self.call(button_name)

    def call(self, function_name: str) -> None:
        body = self.functions.get(function_name)
        if body is None:
            return
        for statement in self._split_statements(body):
            self._execute_statement(statement)

    def _split_statements(self, body: str) -> list[str]:
        statements: list[str] = []
        start = 0
        depth = 0
        for index, char in enumerate(body):
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            elif char == ";" and depth == 0:
                statement = body[start:index].strip()
                if statement:
                    statements.append(statement)
                start = index + 1
        final_statement = body[start:].strip()
        if final_statement:
            statements.append(final_statement)
        return statements

    def _execute_statement(self, statement: str) -> None:
        if match := re.fullmatch(r"if\s*\((.+)\)\s*\{(.*)\}", statement, flags=re.S):
            if self._eval_condition(match.group(1)):
                for inner in self._split_statements(match.group(2)):
                    self._execute_statement(inner)
            return
        if match := re.fullmatch(r"([A-Za-z_$][\w$]*)\+\+", statement):
            name = match.group(1)
            self.variables[name] = int(self.variables.get(name, 0)) + 1
            return
        if match := re.fullmatch(r"([A-Za-z_$][\w$]*)--", statement):
            name = match.group(1)
            self.variables[name] = int(self.variables.get(name, 0)) - 1
            return
        if match := re.fullmatch(r"localStorage\.setItem\(([^,]+),\s*([^)]+)\)", statement):
            key = str(self._eval_expression(match.group(1)))
            value = str(self._eval_expression(match.group(2)))
            self.storage[key] = value
            self._save_storage()
            return
        if match := re.fullmatch(r"document\.getElementById\(([^)]+)\)\.(?:innerHTML|textContent)\s*=\s*(.+)", statement):
            element_id = str(self._eval_expression(match.group(1)))
            value = str(self._eval_expression(match.group(2)))
            self.element_text[element_id] = value
            return
        if match := re.fullmatch(r"alert\((.+)\)", statement):
            from tkinter import messagebox

            messagebox.showinfo(APP_NAME, str(self._eval_expression(match.group(1))))
            return
        if match := re.fullmatch(r"([A-Za-z_$][\w$]*)\(\)", statement):
            self.call(match.group(1))
            return
        if match := re.fullmatch(r"(?:(?:let|var|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+)", statement):
            self.variables[match.group(1)] = self._eval_expression(match.group(2))

    def _eval_condition(self, condition: str) -> bool:
        condition = condition.strip()
        if match := re.fullmatch(r"(.+?)\s*!==\s*(.+)", condition):
            return self._eval_expression(match.group(1)) != self._eval_expression(match.group(2))
        if match := re.fullmatch(r"(.+?)\s*===\s*(.+)", condition):
            return self._eval_expression(match.group(1)) == self._eval_expression(match.group(2))
        if match := re.fullmatch(r"(.+?)\s*>\s*(.+)", condition):
            return self._eval_expression(match.group(1)) > self._eval_expression(match.group(2))
        return bool(self._eval_expression(condition))

    def _eval_expression(self, expression: str) -> object:
        expression = expression.strip()
        if "||" in expression:
            for part in expression.split("||"):
                value = self._eval_expression(part)
                if value not in ("", None, 0, "0"):
                    return value
            return value
        if match := re.fullmatch(r"localStorage\.getItem\((.+)\)", expression):
            return self.storage.get(str(self._eval_expression(match.group(1))))
        if match := re.fullmatch(r"parseInt\((.+)\)", expression):
            return int(self._eval_expression(match.group(1)) or 0)
        if match := re.fullmatch(r"Number\((.+)\)", expression):
            return int(self._eval_expression(match.group(1)) or 0)
        if match := re.fullmatch(r"['\"](.*)['\"]", expression):
            return match.group(1)
        if re.fullmatch(r"-?\d+", expression):
            return int(expression)
        if expression == "null":
            return None
        if "+" in expression:
            left, right = expression.split("+", 1)
            left_value = self._eval_expression(left)
            right_value = self._eval_expression(right)
            if isinstance(left_value, int) and isinstance(right_value, int):
                return left_value + right_value
            return f"{left_value}{right_value}"
        return self.variables.get(expression, expression)

    def snapshot(self) -> dict[str, object]:
        return {
            "elements": self.element_text,
            "storage": self.storage,
            "variables": self.variables,
        }


def load_document() -> Document:
    app_dir = Path(__file__).resolve().parent
    index_path = (app_dir / FRONTEND_DIST / "index.html").resolve()
    if not index_path.exists():
        raise SystemExit(f"Missing frontend entry point: {index_path}")
    parser = HtmlToTkParser()
    parser.feed(index_path.read_text(encoding="utf-8"))
    return parser.document


def run_headless() -> None:
    runtime = MiniJsRuntime(load_document(), Path(__file__).with_suffix(".localstorage.json"))
    for action in filter(None, os.environ.get("TKINTER_WEBAPP_ACTIONS", "").split(",")):
        runtime.click(action)
    print(json.dumps(runtime.snapshot(), sort_keys=True))


def run_tk() -> None:
    import tkinter as tk

    document = load_document()
    runtime = MiniJsRuntime(document, Path(__file__).with_suffix(".localstorage.json"))
    app_dir = Path(__file__).resolve().parent
    snapshot_path = (app_dir / FRONTEND_DIST / "tkinter-snapshot.png").resolve()

    if snapshot_path.exists():
        run_snapshot_tk(tk, document, runtime, snapshot_path)
        return

    if any("phone" in element.attrs.get("class", "").split() for element in document.elements):
        run_iphone_tk(tk, document, runtime)
        return

    root = tk.Tk()
    root.title(WINDOW_TITLE)
    root.geometry("720x480")

    frame = tk.Frame(root, padx=24, pady=24)
    frame.pack(fill=tk.BOTH, expand=True)

    variables: dict[str, tk.StringVar] = {}

    def refresh() -> None:
        for element_id, value in runtime.element_text.items():
            if element_id in variables:
                variables[element_id].set(value)

    for element in document.elements:
        if element.tag == "button":
            action = element.attrs.get("onclick", "").rstrip("();")
            button = tk.Button(
                frame,
                text=element.text or action or "Button",
                command=lambda name=action: (runtime.call(name), refresh()),
            )
            button.pack(anchor=tk.W, pady=4)
        else:
            element_id = element.attrs.get("id")
            if element_id:
                variable = tk.StringVar(value=runtime.element_text.get(element_id, element.text))
                variables[element_id] = variable
                label = tk.Label(frame, textvariable=variable, anchor="w", justify=tk.LEFT)
            else:
                label = tk.Label(frame, text=element.text, anchor="w", justify=tk.LEFT)
            label.pack(anchor=tk.W, fill=tk.X, pady=2)

    root.mainloop()


def run_snapshot_tk(tk, document: Document, runtime: MiniJsRuntime, snapshot_path: Path) -> None:
    root = tk.Tk()
    root.title(WINDOW_TITLE)

    image = tk.PhotoImage(file=snapshot_path)
    root.geometry(f"{image.width()}x{image.height()}")
    root.resizable(False, False)

    canvas = tk.Canvas(root, width=image.width(), height=image.height(), highlightthickness=0)
    canvas.pack(fill=tk.BOTH, expand=True)
    canvas.create_image(0, 0, image=image, anchor=tk.NW)
    canvas.image = image

    status_cover = None
    status_text = None
    width = image.width()
    height = image.height()

    button_elements = [element for element in document.elements if element.tag == "button"]
    phone_layout = any("phone" in element.attrs.get("class", "").split() for element in document.elements)

    def refresh():
        nonlocal status_cover, status_text
        value = runtime.element_text.get("status", "Ready")
        if value == "Ready":
            return
        if status_cover is None:
            if phone_layout:
                status_box = (372, 248, 528, 278)
                status_center = (450, 263)
            else:
                status_box = (width / 2 - 90, 190, width / 2 + 90, 224)
                status_center = (width / 2, 207)
            status_cover = canvas.create_rectangle(*status_box, fill="#223044", outline="")
            status_text = canvas.create_text(
                *status_center,
                text=value,
                fill="#d8f6ff",
                font=("DejaVu Sans", 16, "bold"),
            )
        else:
            canvas.itemconfigure(status_text, text=value)

    def hit_zone(x1, y1, x2, y2, action):
        zone = canvas.create_rectangle(x1, y1, x2, y2, fill="", outline="")
        canvas.tag_bind(zone, "<Button-1>", lambda _event, name=action: (runtime.call(name), refresh()))
        canvas.tag_bind(zone, "<Enter>", lambda _event: canvas.config(cursor="hand2"))
        canvas.tag_bind(zone, "<Leave>", lambda _event: canvas.config(cursor=""))

    if phone_layout:
        zones = [
            (276, 297, 438, 341, "focusMode"),
            (448, 297, 610, 341, "openCamera"),
            (285, 366, 339, 444, "openMessages"),
            (372, 366, 426, 444, "openCamera"),
            (459, 366, 513, 444, "openWallet"),
            (546, 366, 600, 444, "focusMode"),
            (285, 464, 339, 542, "openCamera"),
            (372, 464, 426, 542, "focusMode"),
            (459, 464, 513, 542, "focusMode"),
            (546, 464, 600, 542, "openMessages"),
            (286, 790, 384, 831, "openMessages"),
            (394, 790, 492, 831, "openMessages"),
            (502, 790, 600, 831, "openCamera"),
        ]
    elif width >= 1000 and height <= 800:
        center = width / 2
        grid_left = center - 8
        grid_top = 240
        zones = [
            (166, height - 162, 342, height - 118, "focusMode"),
            (352, height - 162, 528, height - 118, "openCamera"),
            (grid_left, grid_top, grid_left + 80, grid_top + 78, "openMessages"),
            (grid_left + 120, grid_top, grid_left + 200, grid_top + 78, "openCamera"),
            (grid_left + 240, grid_top, grid_left + 320, grid_top + 78, "openWallet"),
            (grid_left + 360, grid_top, grid_left + 440, grid_top + 78, "focusMode"),
            (grid_left, grid_top + 101, grid_left + 80, grid_top + 179, "openCamera"),
            (grid_left + 120, grid_top + 101, grid_left + 200, grid_top + 179, "focusMode"),
            (grid_left + 240, grid_top + 101, grid_left + 320, grid_top + 179, "focusMode"),
            (grid_left + 360, grid_top + 101, grid_left + 440, grid_top + 179, "openMessages"),
            (center - 250, height - 78, center - 90, height - 24, "openMessages"),
            (center - 80, height - 78, center + 80, height - 24, "openMessages"),
            (center + 90, height - 78, center + 250, height - 24, "openCamera"),
        ]
    else:
        center = width / 2
        grid_left = center - 215
        zones = [
            (center - 215, 271, center - 5, 315, "focusMode"),
            (center + 5, 271, center + 215, 315, "openCamera"),
            (grid_left + 0, 358, grid_left + 80, 436, "openMessages"),
            (grid_left + 116, 358, grid_left + 196, 436, "openCamera"),
            (grid_left + 232, 358, grid_left + 312, 436, "openWallet"),
            (grid_left + 348, 358, grid_left + 428, 436, "focusMode"),
            (grid_left + 0, 456, grid_left + 80, 534, "openCamera"),
            (grid_left + 116, 456, grid_left + 196, 534, "focusMode"),
            (grid_left + 232, 456, grid_left + 312, 534, "focusMode"),
            (grid_left + 348, 456, grid_left + 428, 534, "openMessages"),
            (center - 215, height - 72, center - 75, height - 24, "openMessages"),
            (center - 65, height - 72, center + 65, height - 24, "openMessages"),
            (center + 75, height - 72, center + 215, height - 24, "openCamera"),
        ]

    for zone in zones:
        hit_zone(*zone)

    root.mainloop()


def run_iphone_tk(tk, document: Document, runtime: MiniJsRuntime) -> None:
    root = tk.Tk()
    root.title(WINDOW_TITLE)
    root.geometry("900x831")
    root.resizable(False, False)

    canvas = tk.Canvas(root, width=900, height=831, highlightthickness=0, bg="#15161d")
    canvas.pack(fill=tk.BOTH, expand=True)

    status_item: int | None = None

    def rounded_rect(x1, y1, x2, y2, radius, **options):
        points = [
            x1 + radius,
            y1,
            x2 - radius,
            y1,
            x2,
            y1,
            x2,
            y1 + radius,
            x2,
            y2 - radius,
            x2,
            y2,
            x2 - radius,
            y2,
            x1 + radius,
            y2,
            x1,
            y2,
            x1,
            y2 - radius,
            x1,
            y1 + radius,
            x1,
            y1,
        ]
        return canvas.create_polygon(points, smooth=True, splinesteps=18, **options)

    def bind_click(item, action: str):
        if not action:
            return
        canvas.tag_bind(item, "<Button-1>", lambda _event, name=action: (runtime.call(name), refresh()))
        canvas.tag_bind(item, "<Enter>", lambda _event: canvas.config(cursor="hand2"))
        canvas.tag_bind(item, "<Leave>", lambda _event: canvas.config(cursor=""))

    def refresh():
        if status_item is not None:
            canvas.itemconfigure(status_item, text=runtime.element_text.get("status", "Ready"))

    def draw_button(x, y, width, height, label, action, fill="#454854", text_fill="#f7f8fb"):
        button = rounded_rect(x, y, x + width, y + height, height // 2, fill=fill, outline="")
        text = canvas.create_text(
            x + width / 2,
            y + height / 2,
            text=label,
            fill=text_fill,
            font=("DejaVu Sans", 16),
        )
        bind_click(button, action)
        bind_click(text, action)

    def draw_app_icon(index, x, y, glyph, label, action):
        palette = [
            ("#c8f4ff", "#8be2ff"),
            ("#fff0a8", "#ff82a8"),
            ("#b3ffd0", "#62a9ff"),
        ][index % 3]
        rounded_rect(x, y, x + 54, y + 54, 14, fill=palette[1], outline="")
        rounded_rect(x, y, x + 54, y + 54, 14, fill=palette[0], outline="", stipple="gray25")
        glyph_item = canvas.create_text(
            x + 27,
            y + 27,
            text=glyph,
            fill="#101116",
            font=("DejaVu Sans", 13, "bold"),
        )
        label_item = canvas.create_text(
            x + 27,
            y + 72,
            text=label,
            fill="#ffffff",
            font=("DejaVu Sans", 12, "bold"),
        )
        bind_click(glyph_item, action)
        bind_click(label_item, action)

    # Browser viewport background.
    canvas.create_rectangle(0, 0, 900, 831, fill="#15161d", outline="")
    canvas.create_oval(-220, -180, 460, 500, fill="#30313a", outline="")
    canvas.create_oval(230, 580, 650, 1080, fill="#3b2032", outline="")
    canvas.create_oval(510, -80, 1080, 560, fill="#241d29", outline="")

    phone_x = 248
    phone_y = 28
    phone_w = 390
    phone_h = 844
    rounded_rect(phone_x, phone_y, phone_x + phone_w, phone_y + phone_h, 48, fill="#050507", outline="")
    rounded_rect(
        phone_x + 10,
        phone_y + 10,
        phone_x + phone_w - 10,
        phone_y + phone_h - 10,
        38,
        fill="#171923",
        outline="",
    )
    rounded_rect(
        phone_x + 10,
        phone_y + 10,
        phone_x + phone_w - 10,
        phone_y + phone_h - 10,
        38,
        fill="#223044",
        outline="",
    )
    canvas.create_rectangle(phone_x + 20, phone_y + 285, phone_x + 370, phone_y + 410, fill="#171923", outline="")
    canvas.create_oval(phone_x - 6, phone_y + 552, phone_x + 250, phone_y + 888, fill="#55283e", outline="")
    canvas.create_rectangle(phone_x + 20, phone_y + 400, phone_x + 370, phone_y + 790, fill="#171923", outline="")

    x = phone_x + 28
    y = phone_y + 30
    canvas.create_text(x + 10, y + 10, text="9:41", fill="#f7f8fb", font=("DejaVu Sans", 13, "bold"), anchor="w")
    canvas.create_text(
        phone_x + phone_w - 40,
        y + 10,
        text="5G 100%",
        fill="#f7f8fb",
        font=("DejaVu Sans", 13, "bold"),
        anchor="e",
    )
    rounded_rect(phone_x + 136, phone_y + 46, phone_x + 254, phone_y + 80, 17, fill="#000000", outline="")

    canvas.create_text(
        phone_x + phone_w / 2,
        phone_y + 130,
        text="Saturday, June 27",
        fill="#ccd0d7",
        font=("DejaVu Sans", 14, "bold"),
    )
    canvas.create_text(
        phone_x + phone_w / 2,
        phone_y + 184,
        text="9:41",
        fill="#f7f8fb",
        font=("DejaVu Sans", 72, "bold"),
    )
    status_item = canvas.create_text(
        phone_x + phone_w / 2,
        phone_y + 234,
        text=runtime.element_text.get("status", "Ready"),
        fill="#d8f6ff",
        font=("DejaVu Sans", 16, "bold"),
    )

    draw_button(phone_x + 28, phone_y + 269, 162, 44, "Focus", "focusMode")
    draw_button(phone_x + 200, phone_y + 269, 162, 44, "Camera", "openCamera")

    apps = [
        ("M", "Messages", "openMessages"),
        ("C", "Camera", "openCamera"),
        ("W", "Wallet", "openWallet"),
        ("F", "Focus", "focusMode"),
        ("P", "Photos", "openCamera"),
        ("M", "Maps", "focusMode"),
        ("M", "Music", "focusMode"),
        ("N", "Notes", "openMessages"),
    ]
    for index, (glyph, label, action) in enumerate(apps):
        col = index % 4
        row = index // 4
        draw_app_icon(index, phone_x + 38 + col * 87, phone_y + 338 + row * 98, glyph, label, action)

    dock_y = phone_y + phone_h - 94
    rounded_rect(phone_x + 28, dock_y, phone_x + phone_w - 28, dock_y + 64, 28, fill="#ffffff", outline="", stipple="gray50")
    draw_button(phone_x + 38, dock_y + 10, 98, 44, "Phone", "openMessages", fill="#8e8993")
    draw_button(phone_x + 146, dock_y + 10, 98, 44, "Safari", "openMessages", fill="#8e8993")
    draw_button(phone_x + 254, dock_y + 10, 98, 44, "Camera", "openCamera", fill="#777b83")

    root.mainloop()


if __name__ == "__main__":
    if os.environ.get("TKINTER_WEBAPP_TEST"):
        run_headless()
    else:
        try:
            run_tk()
        except Exception as error:
            print(f"Unable to start Tkinter: {error}", file=sys.stderr)
            sys.exit(1)
