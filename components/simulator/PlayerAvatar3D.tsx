"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Player, PlayerColor } from "@/lib/board/types";
import { seatColors } from "@/lib/presentation/accessibility";
import { hexBaseAngle, hexSeatPoint } from "@/lib/presentation/hexBoard";
import { avatarForSeat } from "@/lib/avatars/catalog";

const BASE_SEATS: Record<
  PlayerColor,
  { position: [number, number, number]; rotation: number }
> = {
  red: { position: [0, -0.88, -4.4], rotation: 0 },
  green: { position: [4.82, -0.88, 0], rotation: -Math.PI / 2 },
  yellow: { position: [0, -0.88, 4.4], rotation: Math.PI },
  blue: { position: [-4.82, -0.88, 0], rotation: Math.PI / 2 },
  // Hex-only colours: their seats come from hexAvatarSeat below.
  orange: { position: [4.17, -0.88, -2.4], rotation: -Math.PI / 3 },
  black: { position: [-4.17, -0.88, -2.4], rotation: Math.PI / 3 },
};

/**
 * On the 5-6 player hexagon (F5.2) each figure sits out past its own base's
 * corner, turned to face the table's centre (rotation 0 faces +z).
 */
function hexAvatarSeat(color: PlayerColor) {
  const [x, z] = hexSeatPoint(color, 4.6);
  const angle = hexBaseAngle(color);
  return {
    position: [x, -0.88, z] as [number, number, number],
    rotation: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
  };
}

function AvatarFace({ portrait }: { portrait: string }) {
  const texture = useTexture(portrait);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- R3F owns a mutable Three texture, not immutable React state.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);
  return (
    <mesh position={[0, 0, 0.423]}>
      <circleGeometry args={[0.355, 48]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

// The video card above a seat figure (V3): 4:3, like the camera's own frame.
const CARD_WIDTH = 0.96;
const CARD_HEIGHT = 0.72;
const CARD_BORDER = 0.035;
// How often an off-screen check runs, in seconds.
const VISIBILITY_CHECK = 0.5;

/**
 * A remote player's camera on a card above their seat figure (Section 7, V3).
 * It turns about the vertical axis to face the viewer, so the players beside
 * you are as easy to see as the one across. It takes the room's light, with
 * enough of its own glow to stay readable. Off camera it stops drawing frames
 * until it comes back into view, and tapping it opens the enlarged view with
 * Report and Block.
 */
function VideoCard({
  stream,
  color,
  name,
  onSelect,
}: {
  stream: MediaStream;
  color: string;
  name: string;
  onSelect?: () => void;
}) {
  const [video] = useState(() => {
    const element = document.createElement("video");
    element.muted = true;
    element.playsInline = true;
    element.autoplay = true;
    return element;
  });
  const texture = useMemo(() => {
    const map = new THREE.VideoTexture(video);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [video]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- a detached <video> element feeding the texture, not React state.
    video.srcObject = stream;
    void video.play().catch(() => {});
    // Crop the camera's frame to the card (a phone held upright sends 3:4).
    const crop = () => {
      const { videoWidth: w, videoHeight: h } = video;
      if (!w || !h) return;
      const card = CARD_WIDTH / CARD_HEIGHT;
      const frame = w / h;
      if (frame > card) {
        texture.repeat.set(card / frame, 1);
        texture.offset.set((1 - card / frame) / 2, 0);
      } else {
        texture.repeat.set(1, frame / card);
        texture.offset.set(0, (1 - frame / card) / 2);
      }
    };
    video.addEventListener("loadedmetadata", crop);
    video.addEventListener("resize", crop);
    return () => {
      video.removeEventListener("loadedmetadata", crop);
      video.removeEventListener("resize", crop);
      video.pause();
      video.srcObject = null;
    };
  }, [video, stream, texture]);

  // Off-screen pausing: a card outside the camera's view stops drawing frames.
  const card = useRef<THREE.Mesh>(null);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const viewProjection = useMemo(() => new THREE.Matrix4(), []);
  const sinceCheck = useRef(0);
  const inView = useRef(true);
  useFrame(({ camera }, delta) => {
    sinceCheck.current += delta;
    if (!card.current || sinceCheck.current < VISIBILITY_CHECK) return;
    sinceCheck.current = 0;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const visible = frustum.intersectsObject(card.current);
    if (visible === inView.current) return;
    inView.current = visible;
    if (visible) void video.play().catch(() => {});
    else video.pause();
  });

  return (
    // A little in front of the figure, toward the table, so a side seat's card
    // stays on screen from your seat.
    <Billboard position={[0, 2.12, 0.7]} lockX lockZ>
      <mesh position={[0, 0, -0.002]}>
        <planeGeometry args={[CARD_WIDTH + CARD_BORDER * 2, CARD_HEIGHT + CARD_BORDER * 2]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh
        ref={card}
        name={`${name}'s video`}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          onSelect();
        }}
        onPointerOver={() => onSelect && document.body.classList.add("sim-piece-hover")}
        onPointerOut={() => document.body.classList.remove("sim-piece-hover")}
      >
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive="#ffffff"
          emissiveIntensity={0.55}
          roughness={0.6}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function ProceduralAvatar({
  player,
  seatColor,
  active,
  speaking,
  hex,
  colorBlind,
  reducedMotion,
  videoStream,
  onVideoSelect,
}: {
  player: Player;
  /** The colour whose seat this player takes (a turned Snakes & Ladders table). */
  seatColor: PlayerColor;
  active: boolean;
  speaking: boolean;
  hex: boolean;
  colorBlind: boolean;
  reducedMotion: boolean;
  videoStream?: MediaStream;
  onVideoSelect?: (playerId: string) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const seat = hex ? hexAvatarSeat(seatColor) : BASE_SEATS[seatColor];
  const playerColor = seatColors(colorBlind)[player.color];
  const portrait = avatarForSeat(player.avatarId, player.seatIndex).portrait;
  const playerColorDark = new THREE.Color(playerColor).offsetHSL(0, 0, -0.14);

  useFrame(({ clock }, delta) => {
    if (!root.current || !head.current) return;
    // Under reduced motion the figures sit still: no idle bob or glance.
    const time = reducedMotion ? 0 : clock.elapsedTime + player.seatIndex * 0.8;
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
        <AvatarFace portrait={portrait} />
      </group>
      {videoStream && (
        <VideoCard
          stream={videoStream}
          color={playerColor}
          name={player.displayName}
          onSelect={onVideoSelect && (() => onVideoSelect(player.id))}
        />
      )}
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
  seatOf,
  hex = false,
  colorBlind = false,
  reducedMotion = false,
  videoStreams,
  onVideoSelect,
}: {
  players: Player[];
  turnPlayerId: string | null;
  speakingPlayerIds?: Set<string>;
  preview?: boolean;
  orientation?: number;
  /** Whose seat each colour sits in, when that isn't its own (seatColor). */
  seatOf?: (color: PlayerColor) => PlayerColor;
  /** Seat the figures around the 5-6 player hexagon (F5.2). */
  hex?: boolean;
  colorBlind?: boolean;
  reducedMotion?: boolean;
  /** Remote cameras shown on cards above their figures (V3), by player id. */
  videoStreams?: Map<string, MediaStream>;
  /** A video card was tapped: open that player's enlarged video. */
  onVideoSelect?: (playerId: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    if (reducedMotion) {
      group.current.rotation.y = orientation;
      return;
    }
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
          seatColor={seatOf?.(player.color) ?? player.color}
          active={player.id === turnPlayerId}
          speaking={speakingPlayerIds?.has(player.id) ?? false}
          hex={hex}
          colorBlind={colorBlind}
          reducedMotion={reducedMotion}
          videoStream={videoStreams?.get(player.id)}
          onVideoSelect={onVideoSelect}
        />
      ))}
    </group>
  );
}
