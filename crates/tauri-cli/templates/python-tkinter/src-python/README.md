# Python/Tkinter Backend

This generated backend renders simple static HTML from `{{ frontend_dist }}/index.html` with Tkinter.

Supported web features are intentionally small: text elements, buttons with inline `onclick` handlers, simple counter-style JavaScript functions, `document.getElementById(...).innerHTML` or `.textContent`, `alert(...)`, and `localStorage.getItem` / `setItem`.

Run it with:

```sh
python3 src-python/main.py
```

For headless verification:

```sh
TKINTER_WEBAPP_TEST=1 TKINTER_WEBAPP_ACTIONS=increment,save python3 src-python/main.py
```
