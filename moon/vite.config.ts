import { defineConfig, normalizePath, type Plugin } from "vite";

function isSceneReloadPath(file: string): boolean {
  return file.includes("/src/game/") || file.includes("/src/assets/");
}

function isFullReloadPath(file: string): boolean {
  return (
    file.endsWith("/index.html") ||
    file.includes("/src/app/") ||
    file.includes("/public/") ||
    file.endsWith("/vite.config.ts")
  );
}

function godogenBabylonReload(): Plugin {
  return {
    name: "godogen-babylon-reload",
    apply: "serve",

    async hotUpdate(ctx) {
      if (this.environment.name !== "client") return;

      const file = normalizePath(ctx.file);

      if (isSceneReloadPath(file)) {
        await ctx.read();
        this.environment.hot.send({
          type: "custom",
          event: "godogen:scene-change",
          data: { file, time: ctx.timestamp }
        });
        return [];
      }

      if (isFullReloadPath(file)) {
        await ctx.read();
        this.environment.hot.send({ type: "full-reload", path: "*" });
        return [];
      }

      return;
    }
  };
}

export default defineConfig({
  plugins: [godogenBabylonReload()],

  assetsInclude: [
    "**/*.glb",
    "**/*.gltf",
    "**/*.hdr",
    "**/*.env",
    "**/*.ktx2",
    "**/*.basis",
    "**/*.wasm"
  ],

  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ["warn", "error"]
    }
  },

  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  },

  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    assetsInlineLimit: 0,
    modulePreload: {
      polyfill: false
    },
    sourcemap: true
  }
});
