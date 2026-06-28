import { Engine, Scene } from "./babylon";

export type SceneFactory = (app: BabylonApp) => Scene | Promise<Scene>;

export class BabylonApp {
  readonly engine: Engine;
  scene: Scene | undefined;

  private running = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      stencil: true,
      preserveDrawingBuffer: false
    });

    window.addEventListener("resize", this.resize);
  }

  async load(factory: SceneFactory): Promise<void> {
    const oldScene = this.scene;
    const newScene = await factory(this);

    this.scene = newScene;
    oldScene?.dispose();
  }

  start(): void {
    if (this.running) return;

    this.running = true;

    this.engine.runRenderLoop(() => {
      this.scene?.render();
    });
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.scene?.dispose();
    this.engine.dispose();
  }

  private resize = (): void => {
    this.engine.resize();
  };
}
