# iPhone React to Python/Tkinter

This example builds an iPhone-like UI with React, renders it to static HTML, then uses the Tauri CLI Python/Tkinter backend:

```sh
npm install
npm run build
cargo-tauri init --ci --force --backend python-tkinter --frontend-dist ../dist
TKINTER_WEBAPP_TEST=1 TKINTER_WEBAPP_ACTIONS=focusMode,openCamera python3 src-python/main.py
```
