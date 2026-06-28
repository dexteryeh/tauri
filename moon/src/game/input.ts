export class InputState {
  readonly keys = new Set<string>();
  pointerX = 0;
  pointerY = 0;
  pointerDown = false;

  attach(target: HTMLElement = document.body): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointerup", this.onPointerUp);
  }

  detach(target: HTMLElement = document.body): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);

    target.removeEventListener("pointermove", this.onPointerMove);
    target.removeEventListener("pointerdown", this.onPointerDown);
    target.removeEventListener("pointerup", this.onPointerUp);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
  };

  private onPointerDown = (): void => {
    this.pointerDown = true;
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
  };
}
