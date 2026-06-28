import React from "react";

const apps = [
  ["Messages", "Messages", "openMessages()"],
  ["Camera", "Camera", "openCamera()"],
  ["Wallet", "Wallet", "openWallet()"],
  ["Focus", "Focus", "focusMode()"],
  ["Photos", "Photos", "openCamera()"],
  ["Maps", "Maps", "focusMode()"],
  ["Music", "Music", "focusMode()"],
  ["Notes", "Notes", "openMessages()"],
];

function AppIcon({ label, glyph, action }) {
  return React.createElement(
    "button",
    { className: "app-icon", "data-action": action },
    React.createElement("span", { className: "glyph" }, glyph.slice(0, 1)),
    React.createElement("span", { className: "app-label" }, label),
  );
}

export function App() {
  return React.createElement(
    "main",
    { className: "scene" },
    React.createElement(
      "section",
      { className: "desktop-surface", "aria-label": "iOS style desktop window" },
      React.createElement(
        "header",
        { className: "glance" },
        React.createElement("p", { className: "date" }, "Saturday, June 27"),
        React.createElement("h1", null, "9:41"),
        React.createElement("p", { id: "status", className: "status" }, "Ready"),
      ),
      React.createElement(
        "div",
        { className: "quick-actions" },
        React.createElement("button", { "data-action": "focusMode()" }, "Focus"),
        React.createElement("button", { "data-action": "openCamera()" }, "Camera"),
      ),
      React.createElement(
        "nav",
        { className: "grid", "aria-label": "Apps" },
        apps.map(([label, glyph, action]) =>
          React.createElement(AppIcon, { key: label, label, glyph, action }),
        ),
      ),
      React.createElement(
        "footer",
        { className: "dock" },
        React.createElement("button", { "data-action": "openMessages()" }, "Phone"),
        React.createElement("button", { "data-action": "openMessages()" }, "Safari"),
        React.createElement("button", { "data-action": "openCamera()" }, "Camera"),
      ),
    ),
  );
}
