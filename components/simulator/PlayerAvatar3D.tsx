"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Player, PlayerColor } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";

const BASE_SEATS: Record<
  PlayerColor,
  { position: [number, number, number]; rotation: number }
> = {
  red: { position: [0, -0.88, -4.4], rotation: 0 },
  green: { position: [4.82, -0.88, 0], rotation: -Math.PI / 2 },
  yellow: { position: [0, -0.88, 4.4], rotation: Math.PI },
  blue: { position: [-4.82, -0.88, 0], rotation: Math.PI / 2 },
};

function ProceduralAvatar({
  player,
  active,
  speaking,
}: {
  player: Player;
  active: boolean;
  speaking: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const seat = BASE_SEATS[player.color];
  const playerColor = COLORS[player.color];
  const playerColorDark = new THREE.Color(playerColor).offsetHSL(0, 0, -0.14);

  useFrame(({ clock }, delta) => {
    if (!root.current || !head.current) return;
    const time = clock.elapsedTime + player.seatIndex * 0.8;
    root.current.position.y = seat.position[1] + Math.sin(time * 1.7) * 0.018;
    head.current.rotation.y = THREE.MathUtils.damp(
      head.current.rotation.y,
      Math.sin(time * 0.65) * 0.12,
      6,
      delta,
    );
    head.current.rotation.z = Math.sin(time * 1.1) * 0.025;
    const targetScale = active ? 1.06 : speaking ? 1.03 : 1;
    root.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale),
      1 - Math.exp(-delta * 7),
    );
  });

  return (
    <group ref={root} position={seat.position} rotation={[0, seat.rotation, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.34, 0.55, 6, 16]} />
        <meshPhysicalMaterial
          color={playerColorDark}
          roughness={0.36}
          clearcoat={0.55}
          clearcoatRoughness={0.25}
        />
      </mesh>
      <group ref={head} position={[0, 1.08, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.43, 28, 20]} />
          <meshPhysicalMaterial
            color={playerColor}
            roughness={0.3}
            clearcoat={0.7}
            clearcoatRoughness={0.18}
          />
        </mesh>
        <mesh position={[-0.145, 0.06, 0.39]}>
          <sphereGeometry args={[0.05, 12, 8]} />
          <meshBasicMaterial color="#172019" />
        </mesh>
        <mesh position={[0.145, 0.06, 0.39]}>
          <sphereGeometry args={[0.05, 12, 8]} />
          <meshBasicMaterial color="#172019" />
        </mesh>
        <mesh position={[-0.145, 0.075, 0.432]}>
          <sphereGeometry args={[0.014, 8, 6]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.145, 0.075, 0.432]}>
          <sphereGeometry args={[0.014, 8, 6]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
      {active && (
        <mesh position={[0, 1.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.32, 0.025, 8, 32]} />
          <meshBasicMaterial color={playerColor} transparent opacity={0.82} />
        </mesh>
      )}
      {speaking && (
        <pointLight position={[0, 1.05, 0.55]} color={playerColor} intensity={0.7} distance={2} />
      )}
    </group>
  );
}

export function PlayerAvatars3D({
  players,
  turnPlayerId,
  speakingPlayerIds,
  preview,
  orientation = 0,
}: {
  players: Player[];
  turnPlayerId: string | null;
  speakingPlayerIds?: Set<string>;
  preview?: boolean;
  orientation?: number;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.y +=
      Math.atan2(
        Math.sin(orientation - group.current.rotation.y),
        Math.cos(orientation - group.current.rotation.y),
      ) *
      (1 - Math.exp(-delta * 9));
  });
  if (preview) return null;
  return (
    <group ref={group} rotation={[0, orientation, 0]}>
      {players.map((player) => (
        <ProceduralAvatar
          key={player.id}
          player={player}
          active={player.id === turnPlayerId}
          speaking={speakingPlayerIds?.has(player.id) ?? false}
        />
      ))}
    </group>
  );
}
