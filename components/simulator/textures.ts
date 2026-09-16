import * as THREE from "three";
import { COLORS } from "@/lib/presentation/board";
import { COLOR_ORDER, SAFE_CELLS } from "@/lib/board/geometry";
import {
  BASE_AREA,
  HOME_LANE_CELLS,
  globalCellToGridPosition,
} from "../arena/boardLayout";

function texture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

export function makeBoardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1536;
  const ctx = canvas.getContext("2d")!;
  const c = canvas.width / 15;
  ctx.fillStyle = "#f4eedc";
  ctx.fillRect(0, 0, 1536, 1536);
  for (let row = 0; row < 15; row++)
    for (let col = 0; col < 15; col++) {
      ctx.strokeStyle = "#bcb5a1";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(col * c, row * c, c, c);
    }
  for (const color of COLOR_ORDER) {
    const base = BASE_AREA[color];
    const x = base.colStart * c,
      y = base.rowStart * c;
    ctx.fillStyle = COLORS[color];
    ctx.fillRect(x, y, c * 6, c * 6);
    ctx.strokeStyle = "#ffffff55";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 14, y + 14, c * 6 - 28, c * 6 - 28);
    ctx.fillStyle = "#f8f1df";
    ctx.beginPath();
    ctx.roundRect(x + c * 0.83, y + c * 0.83, c * 4.34, c * 4.34, 22);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const cx = x + (2 + (i % 2) * 2) * c,
        cy = y + (2 + Math.floor(i / 2) * 2) * c;
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[color] + "22";
      ctx.fill();
      ctx.strokeStyle = COLORS[color];
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.36, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS[color] + "66";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    HOME_LANE_CELLS[color].forEach(([row, col]) => {
      ctx.fillStyle = COLORS[color];
      ctx.fillRect(col * c, row * c, c, c);
      ctx.strokeStyle = "#ffffff88";
      ctx.lineWidth = 1.8;
      ctx.strokeRect(col * c, row * c, c, c);
      ctx.fillStyle = "#ffffff80";
      ctx.beginPath();
      ctx.arc((col + 0.5) * c, (row + 0.5) * c, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  [...SAFE_CELLS].forEach((cell) => {
    const { row, col } = globalCellToGridPosition(cell);
    const isEntry = cell % 13 === 0;
    const color = COLOR_ORDER[Math.floor(cell / 13)];
    if (isEntry) {
      ctx.fillStyle = COLORS[color];
      ctx.fillRect(col * c, row * c, c, c);
    }
    ctx.fillStyle = isEntry ? "#ffffff" : "#b9a77e";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5,
        r = c * (i % 2 ? 0.13 : 0.29);
      const x = (col + 0.5) * c + Math.cos(angle) * r,
        y = (row + 0.5) * c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  });
  const corners = [
    [6, 6, 9, 6],
    [9, 6, 9, 9],
    [9, 9, 6, 9],
    [6, 9, 6, 6],
  ];
  const centerColors = ["green", "yellow", "blue", "red"] as const;
  corners.forEach(([x1, y1, x2, y2], i) => {
    ctx.fillStyle = COLORS[centerColors[i]];
    ctx.beginPath();
    ctx.moveTo(x1 * c, y1 * c);
    ctx.lineTo(x2 * c, y2 * c);
    ctx.lineTo(7.5 * c, 7.5 * c);
    ctx.closePath();
    ctx.fill();
  });
  ctx.fillStyle = "#f6edd8";
  ctx.beginPath();
  ctx.arc(7.5 * c, 7.5 * c, 19, 0, Math.PI * 2);
  ctx.fill();
  return texture(canvas);
}

export function makeFabricTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#bdbab0";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) {
    ctx.fillStyle = i % 4 ? "#aaa79e" : "#d7d4ca";
    ctx.fillRect(i, 0, 1, 128);
    ctx.fillStyle = "#ffffff35";
    ctx.fillRect(0, i, 128, 1);
  }
  const map = texture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(5, 5);
  return map;
}
