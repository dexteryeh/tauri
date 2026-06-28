# Using This Tauri Version

This repository is a local Tauri workspace with additional game-oriented examples and a custom `python-tkinter` backend template for `cargo-tauri init`.

Use the upstream `README.md` for general Tauri background. This file focuses on the changes and workflows in this checkout.

## What Is Included

- The normal Tauri Rust workspace under `crates/`, `packages/`, `examples/`, and `bench/`.
- A custom Tauri CLI backend template:
  - `crates/tauri-cli/templates/python-tkinter/`
  - `crates/tauri-cli/scripts/verify-python-tkinter-web-example.py`
- A React-to-Python/Tkinter example:
  - `examples/iphone-react-python/`
- Babylon/Vite game projects:
  - `driftline/`
  - `driftline-tauri/`
  - `moon/`

## Requirements

Install the normal Tauri development prerequisites for your platform, then make sure these tools are available:

```sh
rustc --version
cargo --version
node --version
pnpm --version
python3 --version
```

This workspace expects Rust `1.77.2` or newer. The JavaScript workspace uses `pnpm@10.30.3`. The game examples expect Node `22.12` or newer.

On Ubuntu/Linux, Tauri desktop development also needs WebKitGTK and other native build libraries. Follow the current Tauri Linux prerequisites if those packages are not already installed.

## Install Workspace Dependencies

From the repository root:

```sh
pnpm install
```

For Rust dependencies, Cargo will resolve them when you build or test:

```sh
cargo check
```

## Build The Local Tauri CLI

This version modifies the local Tauri CLI, so use the CLI from this checkout when testing the new backend.

```sh
cargo build -p tauri-cli
```

The built binary is available at:

```sh
./target/debug/cargo-tauri
```

You can run it directly:

```sh
./target/debug/cargo-tauri --help
```

Or install it locally from this checkout:

```sh
cargo install --path crates/tauri-cli --locked
```

After installing, verify that your shell resolves the local version:

```sh
cargo-tauri --help
```

## Use The Python/Tkinter Backend

The custom backend generates a small Python/Tkinter runtime that renders static HTML from a frontend build directory.

Example flow:

```sh
mkdir my-python-tauri-app
cd my-python-tauri-app
mkdir dist
printf '<main><h1>Hello</h1><button onclick="alert(\"Hi\")">Click</button></main>' > dist/index.html
../target/debug/cargo-tauri init --ci --force --backend python-tkinter --frontend-dist ../dist
python3 src-python/main.py
```

For headless verification:

```sh
TKINTER_WEBAPP_TEST=1 python3 src-python/main.py
```

The template supports a deliberately small web feature set: static text, simple buttons, inline `onclick` handlers, basic counter-style JavaScript, `document.getElementById(...).innerHTML` or `.textContent`, `alert(...)`, and `localStorage.getItem` / `setItem`.

## Run The iPhone React Python Example

From the repository root:

```sh
cd examples/iphone-react-python
npm install
npm run build
../../target/debug/cargo-tauri init --ci --force --backend python-tkinter --frontend-dist ../dist
TKINTER_WEBAPP_TEST=1 TKINTER_WEBAPP_ACTIONS=focusMode,openCamera python3 src-python/main.py
```

If you installed the local CLI with `cargo install`, you can use `cargo-tauri` instead of `../../target/debug/cargo-tauri`.

## Run The Game Examples

For the browser-only Babylon examples:

```sh
cd driftline
npm install
npm run dev
```

```sh
cd moon
npm install
npm run dev
```

For the Tauri-wrapped game:

```sh
cd driftline-tauri
npm install
npm run tauri:dev
```

To build it:

```sh
npm run tauri:build
```

## Common Workspace Commands

From the repository root:

```sh
pnpm run format:check
pnpm run ts:check
pnpm run build:cli
cargo check
```

For the Python/Tkinter backend verification script:

```sh
python3 crates/tauri-cli/scripts/verify-python-tkinter-web-example.py
```

## Notes

- `node_modules/`, Rust `target/`, generated `dist/` folders, and local agent metadata are intentionally not part of the source workflow.
- The root `origin` remote may still point to a Tauri fork. The `ai-games` remote points to `https://github.com/dexteryeh/ai-games.git`.
- The file is named `READMD.md` because that is the requested filename. If you want GitHub to show it automatically on the repository home page, rename or copy it to `README.md`.
