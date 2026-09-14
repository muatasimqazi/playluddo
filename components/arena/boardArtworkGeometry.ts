import type { PlayerColor } from "@/lib/board/types";

export const NEST_SLOT_POSITIONS: Record<PlayerColor, readonly (readonly [number, number])[]> = {
  red: [
    [10.52, 10.726],
    [89.728, 10.726],
    [11.345, 88.903],
    [89.315, 88.903],
  ],
  green: [
    [9.86, 10.932],
    [88.243, 11.345],
    [10.685, 88.903],
    [88.243, 88.903],
  ],
  yellow: [
    [10.479, 10.479],
    [88.861, 9.86],
    [10.685, 88.243],
    [88.243, 88.243],
  ],
  blue: [
    [10.52, 9.86],
    [89.109, 10.479],
    [11.345, 88.243],
    [89.728, 88.655],
  ],
};
