export interface GameState {
  time: number;
  score: number;
}

export function createGameState(): GameState {
  return {
    time: 0,
    score: 0
  };
}
