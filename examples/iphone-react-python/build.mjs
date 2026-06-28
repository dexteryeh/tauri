import { mkdir, readFile, writeFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./src/App.mjs";

const styles = await readFile(new URL("./src/styles.css", import.meta.url), "utf8");
const body = renderToStaticMarkup(React.createElement(App)).replaceAll("data-action=", "onclick=");

const script = String.raw`
let phoneStatus = localStorage.getItem("phoneStatus") || "Ready";
document.getElementById("status").innerHTML = phoneStatus;

function focusMode() {
  phoneStatus = "Focus on";
  localStorage.setItem("phoneStatus", phoneStatus);
  document.getElementById("status").innerHTML = localStorage.getItem("phoneStatus");
}

function openCamera() {
  phoneStatus = "Camera ready";
  localStorage.setItem("phoneStatus", phoneStatus);
  document.getElementById("status").innerHTML = localStorage.getItem("phoneStatus");
}

function openMessages() {
  phoneStatus = "Messages open";
  localStorage.setItem("phoneStatus", phoneStatus);
  document.getElementById("status").innerHTML = localStorage.getItem("phoneStatus");
}

function openWallet() {
  phoneStatus = "Wallet ready";
  localStorage.setItem("phoneStatus", phoneStatus);
  document.getElementById("status").innerHTML = localStorage.getItem("phoneStatus");
}
`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>iPhone React Python</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="root">${body}</div>
    <script>${script}</script>
  </body>
</html>
`;

await mkdir(new URL("./dist", import.meta.url), { recursive: true });
await writeFile(new URL("./dist/index.html", import.meta.url), html);
