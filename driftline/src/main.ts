import "./style.css";
import { BabylonApp } from "./app/BabylonApp";
import { createScene } from "./game/scene";

interface SceneChangePayload {
  file: string;
  time: number;
}

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");

if (!canvas) {
  throw new Error("Missing #game-canvas");
}

const app = new BabylonApp(canvas);

await app.load(createScene);
app.start();

if (import.meta.env.DEV && import.meta.hot) {
  import.meta.hot.on("godogen:scene-change", async (payload: SceneChangePayload) => {
    console.info(`[godogen] scene reload: ${payload.file}`);
    const sceneUrl = `/src/game/scene.ts?godogen-reload=${payload.time}`;
    const sceneModule = await import(/* @vite-ignore */ sceneUrl);
    await app.load(sceneModule.createScene);
  });

  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
