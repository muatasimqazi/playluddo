"use client";

import { useEffect, useMemo } from "react";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Point, Quality } from "@/lib/presentation/board";
import { makeFabricTexture } from "./textures";

function Box({
  position,
  size,
  color,
  round = 0,
  map,
  metal = 0,
  roughness = 0.72,
  rotation,
}: {
  position: Point;
  size: Point;
  color: string;
  round?: number;
  map?: THREE.Texture;
  metal?: number;
  roughness?: number;
  rotation?: Point;
}) {
  const material = (
    <meshStandardMaterial
      color={color}
      map={map}
      roughness={roughness}
      metalness={metal}
    />
  );
  return round ? (
    <RoundedBox
      position={position}
      args={size}
      radius={round}
      smoothness={3}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      {material}
    </RoundedBox>
  ) : (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {material}
    </mesh>
  );
}

function Plant({ position, scale = 1 }: { position: Point; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.43, 0.32, 0.84, 24]} />
        <meshStandardMaterial color="#b7aa91" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.38, 0.38, 0.025, 24]} />
        <meshStandardMaterial color="#352c23" />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => {
        const angle = i * 2.4,
          height = 1.4 + (i % 3) * 0.4;
        return (
          <group key={i} rotation={[0, angle, 0]}>
            <mesh
              position={[0.14, height / 2 + 0.8, 0]}
              rotation={[0, 0, -0.18]}
            >
              <cylinderGeometry args={[0.018, 0.024, height, 5]} />
              <meshStandardMaterial color="#5d6845" />
            </mesh>
            <mesh
              position={[0.4, height + 0.5, 0]}
              rotation={[0.2, 0, -0.6]}
              scale={[0.28, 0.72, 0.075]}
              castShadow
            >
              <sphereGeometry args={[1, 12, 10]} />
              <meshStandardMaterial
                color={i % 2 ? "#627553" : "#3a5b43"}
                roughness={0.65}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Sofa({ fabric }: { fabric: THREE.Texture }) {
  return (
    <group position={[0, -2.6, -6.3]}>
      <Box
        position={[0, 0.42, 0]}
        size={[9, 0.6, 2.65]}
        color="#71664f"
        round={0.12}
      />
      <Box
        position={[0, 1.35, -1]}
        size={[9, 2.1, 0.55]}
        color="#eee3cf"
        round={0.2}
        map={fabric}
      />
      {[-3, 0, 3].map((x) => (
        <group key={x}>
          <Box
            position={[x, 0.95, 0.12]}
            size={[2.92, 0.55, 2.05]}
            color="#f4ebdc"
            round={0.18}
            map={fabric}
          />
          <Box
            position={[x, 1.85, -0.68]}
            size={[2.82, 1.35, 0.44]}
            color="#eee5d6"
            round={0.17}
            map={fabric}
            rotation={[-0.12, 0, 0]}
          />
        </group>
      ))}
      {[-4.5, 4.5].map((x) => (
        <Box
          key={x}
          position={[x, 1.1, 0]}
          size={[0.45, 1.65, 2.7]}
          color="#e8dcc6"
          round={0.15}
          map={fabric}
        />
      ))}
      <Box
        position={[-3.05, 0.84, 2]}
        size={[2.95, 0.7, 2.5]}
        color="#f1e7d4"
        round={0.16}
        map={fabric}
      />
      {[
        [-3.1, 2, -0.05],
        [2.9, 2, -0.12],
      ].map((p, i) => (
        <Box
          key={i}
          position={p as Point}
          size={[1.25, 1.25, 0.4]}
          rotation={[-0.18, 0, i ? 0.22 : -0.2]}
          color={i ? "#b39e76" : "#b6bbb0"}
          round={0.2}
          map={fabric}
        />
      ))}
    </group>
  );
}

function Kitchen({ wood }: { wood: THREE.Texture }) {
  return (
    <group position={[6, -2.6, -11.4]}>
      <Box position={[0, 1.5, 0]} size={[9, 3, 1.8]} color="#777c70" />
      <Box
        position={[0, 3.03, 0.08]}
        size={[9.1, 0.15, 2]}
        color="#ddd9c8"
        roughness={0.25}
      />
      <Box position={[0, 5.8, 0.08]} size={[9, 2, 1.6]} color="#dbd5c6" />
      {Array.from({ length: 8 }, (_, i) => (
        <group key={i}>
          <Box
            position={[-4 + i * 1.1, 1.4, 0.92]}
            size={[0.025, 2.8, 0.015]}
            color="#3d453e"
          />
          <Box
            position={[-3.6 + i * 1.1, 2.2, 0.94]}
            size={[0.045, 0.45, 0.05]}
            color="#d1c6a5"
            metal={0.8}
          />
        </group>
      ))}
      <Box
        position={[0, 1.45, 4.7]}
        size={[6.4, 2.9, 2.1]}
        color="#a5987b"
        map={wood}
      />
      <Box
        position={[0, 2.99, 4.7]}
        size={[6.7, 0.2, 2.35]}
        color="#dad7c9"
        roughness={0.2}
      />
      {[-2, 0, 2].map((x) => (
        <group key={x} position={[x, 0, 6.6]}>
          <Box
            position={[0, 1.95, 0]}
            size={[1.25, 0.22, 1.1]}
            color="#2f3430"
            round={0.1}
          />
          {[-0.4, 0.4].map((z) => (
            <Box
              key={z}
              position={[z, 0.9, 0]}
              size={[0.07, 1.8, 0.7]}
              color="#252c29"
              metal={0.4}
            />
          ))}
        </group>
      ))}
      {[-1.8, 1.8].map((x) => (
        <group key={x}>
          <mesh position={[x, 7, 4.7]}>
            <cylinderGeometry args={[0.02, 0.02, 4, 8]} />
            <meshStandardMaterial color="#353831" />
          </mesh>
          <mesh position={[x, 5, 4.7]} castShadow>
            <coneGeometry args={[0.62, 0.8, 32, 1, true]} />
            <meshStandardMaterial
              color="#8c6141"
              metalness={0.7}
              roughness={0.35}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[x, 4.64, 4.7]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.5, 24]} />
            <meshBasicMaterial color="#ffe7b1" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Apartment({ quality }: { quality: Quality }) {
  const originalWood = useTexture("/textures/board-wood.jpg");
  const wood = useMemo(() => {
    const t = originalWood.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [originalWood]);
  const fabric = useMemo(() => makeFabricTexture(), []);
  useEffect(
    () => () => {
      wood.dispose();
      fabric.dispose();
    },
    [wood, fabric],
  );
  return (
    <group>
      <Box
        position={[0, -2.73, 0]}
        size={[27, 0.25, 28]}
        color="#9f9d91"
        roughness={0.32}
      />
      {/* Expansion joints in the polished concrete. */}
      {[-10, -5, 0, 5, 10].map((p) => (
        <group key={p}>
          <Box
            position={[p, -2.597, 0]}
            size={[0.016, 0.002, 28]}
            color="#797c73"
          />
          <Box
            position={[0, -2.596, p]}
            size={[27, 0.002, 0.016]}
            color="#797c73"
          />
        </group>
      ))}
      <Box
        position={[0, -2.57, 0]}
        size={[13, 0.065, 11.5]}
        color="#8b8d83"
        map={fabric}
        round={0.025}
      />
      <Box position={[0, 6, -13.7]} size={[27, 17.2, 0.3]} color="#d1cabb" />
      <Box position={[13.5, 6, 0]} size={[0.3, 17.2, 28]} color="#d6d0c2" />
      <Box position={[0, 6, 13.7]} size={[27, 17.2, 0.3]} color="#c9c2b3" />
      <Box position={[0, 14.65, 0]} size={[27, 0.25, 28]} color="#eee7d8" />
      {/* Curved inset ceiling and warm cove lighting. */}
      <RoundedBox
        position={[0, 14.46, 0]}
        args={[20, 0.13, 18]}
        radius={0.065}
        smoothness={4}
      >
        <meshStandardMaterial color="#e9e0cf" />
      </RoundedBox>
      <mesh
        position={[0, 14.39, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, 0.8, 1]}
      >
        <torusGeometry args={[9, 0.035, 8, 80]} />
        <meshBasicMaterial color="#ffe2a3" />
      </mesh>
      {[-7, 0, 7].flatMap((x) =>
        [-8, 0, 8].map((z) => (
          <mesh
            key={`${x}-${z}`}
            position={[x, 14.37, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.18, 20]} />
            <meshBasicMaterial color="#fff2d3" side={THREE.DoubleSide} />
          </mesh>
        )),
      )}
      {/* Windows look out onto actual distant geometry, never a background photo. */}
      {[-10, -5, 0, 5, 10].map((z) => (
        <group key={z}>
          <mesh position={[-13.25, 6, z]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[4.85, 17]} />
            <meshStandardMaterial
              color="#c6d8cf"
              transparent
              opacity={0.16}
              metalness={0.4}
              roughness={0.1}
              side={THREE.DoubleSide}
            />
          </mesh>
          <Box
            position={[-13.1, 6, z - 2.5]}
            size={[0.18, 17.2, 0.1]}
            color="#444c46"
            metal={0.5}
          />
        </group>
      ))}
      {/* Remove the solid window wall: skyline spans the view beyond open frames. */}
      <Box position={[-17, -2, 0]} size={[7, 0.2, 28]} color="#979d92" />
      {Array.from({ length: 18 }, (_, i) => {
        const z = -22 + i * 2.7,
          h = 3 + ((i * 13) % 11);
        return (
          <Box
            key={i}
            position={[-22 - (i % 3) * 3, -9 + h / 2, z]}
            size={[2 + (i % 3), h, 2]}
            color={i % 2 ? "#8a9a94" : "#a9b2a8"}
          />
        );
      })}
      <Box
        position={[-15.8, -0.2, 0]}
        size={[0.06, 0.07, 28]}
        color="#5b6861"
        metal={0.4}
      />
      {Array.from({ length: 15 }, (_, i) => (
        <Box
          key={i}
          position={[-15.8, -1.3, -13 + i * 1.85]}
          size={[0.04, 2.2, 0.04]}
          color="#5b6861"
          metal={0.4}
        />
      ))}
      {[-11.9, 11.9].map((z) => (
        <group key={z}>
          {Array.from({ length: 13 }, (_, i) => (
            <mesh
              key={i}
              position={[-12.7, 3.4, z + (i - 6) * 0.12]}
              castShadow
            >
              <cylinderGeometry args={[0.12, 0.14, 11.8, 8]} />
              <meshStandardMaterial
                color={i % 2 ? "#beb6a2" : "#d4cbb5"}
                roughness={1}
              />
            </mesh>
          ))}
        </group>
      ))}
      <Sofa fabric={fabric} />
      <Kitchen wood={wood} />
      {/* Walnut shelving behind the sectional. */}
      <group position={[-4.1, -2.6, -12.9]}>
        <Box
          position={[0, 3.5, 0]}
          size={[7.5, 7, 0.22]}
          color="#574c3b"
          map={wood}
        />
        {[0.2, 2.4, 4.6, 6.8].map((y) => (
          <Box
            key={y}
            position={[0, y, 0.5]}
            size={[7.6, 0.14, 1.2]}
            color="#877354"
            map={wood}
          />
        ))}
        {[-3.75, 0, 3.75].map((x) => (
          <Box
            key={x}
            position={[x, 3.5, 0.5]}
            size={[0.12, 7, 1.2]}
            color="#8b7758"
            map={wood}
          />
        ))}
        {quality !== "low" &&
          Array.from({ length: 22 }, (_, i) => (
            <Box
              key={i}
              position={[-3.1 + (i % 11) * 0.29, i < 11 ? 3.05 : 5.3, 0.6]}
              size={[0.18, 1.1 + (i % 3) * 0.12, 0.6]}
              color={["#c5b38c", "#757e6c", "#e1d6c0", "#a26f58"][i % 4]}
            />
          ))}
      </group>
      <Plant position={[-9, -2.6, -7]} scale={1.6} />
      <Plant position={[9, -2.6, 5]} scale={1.3} />
      <group position={[6, -2.6, -3]}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.6, 0.65, 0.16, 32]} />
          <meshStandardMaterial color="#514733" metalness={0.65} />
        </mesh>
        <mesh position={[0, 2.6, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 5, 12]} />
          <meshStandardMaterial color="#998254" metalness={0.7} />
        </mesh>
        <mesh position={[0, 4.8, 0]}>
          <cylinderGeometry args={[0.55, 0.85, 1.1, 32, 1, true]} />
          <meshStandardMaterial color="#e1d2af" side={THREE.DoubleSide} />
        </mesh>
        <pointLight
          position={[0, 4.3, 0]}
          intensity={5}
          color="#ffd5a0"
          distance={10}
          decay={2}
        />
      </group>
      {/* Four physical places at the table. */}
      {[
        [0, 6.2, 0],
        [-6.2, 0, Math.PI / 2],
        [6.2, 0, -Math.PI / 2],
      ].map(([x, z, r], i) => (
        <group key={i} position={[x, -2.6, z]} rotation={[0, r, 0]}>
          <Box
            position={[0, 0.8, 0]}
            size={[2.6, 1.3, 2.2]}
            color="#c7beac"
            round={0.22}
            map={fabric}
          />
          <Box
            position={[0, 1.75, 1]}
            size={[2.6, 1.8, 0.4]}
            color="#c7beac"
            round={0.16}
            map={fabric}
          />
        </group>
      ))}
      {/* Coffee table: thin solid walnut top, chamfered edge and splayed legs. */}
      <Box
        position={[0, -0.19, 0]}
        size={[8.5, 0.36, 7.65]}
        color="#a1845e"
        map={wood}
        round={0.14}
        roughness={0.32}
      />
      <Box
        position={[0, -0.4, 0]}
        size={[8.15, 0.09, 7.3]}
        color="#554b36"
        map={wood}
        round={0.04}
      />
      {[-3.3, 3.3].flatMap((x) =>
        [-2.8, 2.8].map((z) => (
          <Box
            key={`${x}-${z}`}
            position={[x, -1.5, z]}
            size={[0.32, 2.25, 0.32]}
            color="#4d493b"
            rotation={[z * 0.025, 0, -x * 0.025]}
            metal={0.35}
          />
        )),
      )}
      {/* Small everyday objects establish scale without cluttering the play surface. */}
      <group position={[-3.65, 0.02, -2.5]}>
        <mesh>
          <cylinderGeometry args={[0.35, 0.35, 0.045, 32]} />
          <meshStandardMaterial color="#75664d" />
        </mesh>
        <mesh position={[0, 0.19, 0]} castShadow>
          <cylinderGeometry args={[0.23, 0.18, 0.34, 32]} />
          <meshStandardMaterial color="#ded5bd" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.365, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.207, 32]} />
          <meshStandardMaterial color="#463123" />
        </mesh>
        <mesh position={[-0.25, 0.2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.12, 0.035, 8, 20]} />
          <meshStandardMaterial color="#ded5bd" roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}
