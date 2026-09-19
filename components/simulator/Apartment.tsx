"use client";

import { useEffect, useMemo } from "react";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Point, Quality } from "@/lib/presentation/board";

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

function Plant({
  position,
  cactus,
  scale = 1,
}: {
  position: Point;
  cactus: THREE.Texture;
  scale?: number;
}) {
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
                map={cactus}
                color={i % 2 ? "#e2ead9" : "#ffffff"}
                roughness={0.78}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Sofa({
  fabric,
  pillow,
}: {
  fabric: THREE.Texture;
  pillow: THREE.Texture;
}) {
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
        color="#ffffff"
        round={0.2}
        map={fabric}
      />
      {[-3, 0, 3].map((x) => (
        <group key={x}>
          <Box
            position={[x, 0.95, 0.12]}
            size={[2.92, 0.55, 2.05]}
            color="#ffffff"
            round={0.18}
            map={fabric}
          />
          <Box
            position={[x, 1.85, -0.68]}
            size={[2.82, 1.35, 0.44]}
            color="#ffffff"
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
          color="#ffffff"
          round={0.15}
          map={fabric}
        />
      ))}
      <Box
        position={[-3.05, 0.84, 2]}
        size={[2.95, 0.7, 2.5]}
        color="#ffffff"
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
          size={[1.55, 1.05, 0.4]}
          rotation={[-0.18, 0, i ? 0.22 : -0.2]}
          color="#ffffff"
          round={0.2}
          map={pillow}
        />
      ))}
    </group>
  );
}

function IslandDecor() {
  const stems = [
    [-0.2, 0.05, -0.16],
    [-0.12, 0.16, 0.08],
    [-0.04, -0.08, -0.04],
    [0.06, 0.12, 0.12],
    [0.14, -0.15, 0.02],
    [0.21, 0.03, -0.1],
  ] as const;
  return (
    <group position={[0, 3.13, 4.7]}>
      {/* Small white ceramic pitcher. */}
      <group position={[-1.05, 0, 0.05]}>
        <mesh position={[0, 0.34, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.25, 0.68, 24]} />
          <meshStandardMaterial color="#f4f1e9" roughness={0.42} />
        </mesh>
        <mesh position={[0.03, 0.73, 0]} rotation={[0, 0, -0.18]} castShadow>
          <cylinderGeometry args={[0.12, 0.16, 0.26, 24]} />
          <meshStandardMaterial color="#f4f1e9" roughness={0.42} />
        </mesh>
        <mesh position={[-0.19, 0.54, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.18, 0.035, 10, 24, Math.PI * 1.55]} />
          <meshStandardMaterial color="#f4f1e9" roughness={0.42} />
        </mesh>
      </group>

      {/* Ribbed stone vase and abstract brass stems. */}
      <group position={[-0.38, 0, -0.02]}>
        <mesh position={[0, 0.23, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.31, 0.46, 12]} />
          <meshStandardMaterial color="#777a72" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.48, 0]}>
          <cylinderGeometry args={[0.12, 0.2, 0.12, 12]} />
          <meshStandardMaterial color="#85877f" roughness={0.75} />
        </mesh>
        {[-0.12, 0, 0.12].map((x, i) => (
          <mesh
            key={x}
            position={[x * 0.45, 0.83, 0]}
            rotation={[0, 0, (i - 1) * -0.28]}
            castShadow
          >
            <cylinderGeometry args={[0.025, 0.045, 0.72, 8]} />
            <meshStandardMaterial
              color="#c69a3e"
              metalness={0.85}
              roughness={0.2}
            />
          </mesh>
        ))}
      </group>

      {/* Tall white planter with clustered leafy stems. */}
      <group position={[0.75, 0, 0]}>
        <mesh position={[0, 0.43, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.3, 0.86, 28]} />
          <meshStandardMaterial color="#f2f0e9" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.87, 0]}>
          <cylinderGeometry args={[0.31, 0.31, 0.025, 24]} />
          <meshStandardMaterial color="#493c2a" roughness={1} />
        </mesh>
        {stems.map(([x, tilt, z], stemIndex) => {
          const height = 1.2 + (stemIndex % 3) * 0.18;
          return (
            <group key={stemIndex} position={[x, 0.85, z]} rotation={[0, 0, tilt]}>
              <mesh position={[0, height / 2, 0]} castShadow>
                <cylinderGeometry args={[0.014, 0.02, height, 6]} />
                <meshStandardMaterial color="#526d34" roughness={0.9} />
              </mesh>
              {Array.from({ length: 7 }, (_, leafIndex) => {
                const y = 0.2 + leafIndex * (height / 8);
                const side = leafIndex % 2 ? 1 : -1;
                return (
                  <mesh
                    key={leafIndex}
                    position={[side * 0.13, y, 0]}
                    rotation={[0, 0, side * -0.65]}
                    scale={[0.07, 0.22, 0.04]}
                    castShadow
                  >
                    <sphereGeometry args={[1, 8, 6]} />
                    <meshStandardMaterial
                      color={leafIndex % 3 ? "#688342" : "#7e963e"}
                      roughness={0.9}
                    />
                  </mesh>
                );
              })}
            </group>
          );
        })}
      </group>
    </group>
  );
}

function Kitchen({
  island,
  stool,
}: {
  island: THREE.Texture;
  stool: THREE.Texture;
}) {
  return (
    <group position={[6, -2.6, -11.4]}>
      <Box
        position={[0, 1.5, 0]}
        size={[9, 3, 1.8]}
        color="#ffffff"
        map={island}
        roughness={0.7}
      />
      <Box
        position={[0, 3.03, 0.08]}
        size={[9.1, 0.15, 2]}
        color="#ddd9c8"
        roughness={0.25}
      />
      <Box
        position={[0, 5.8, 0.08]}
        size={[9, 2, 1.6]}
        color="#ffffff"
        map={island}
        roughness={0.7}
      />
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
        color="#ffffff"
        map={island}
        roughness={0.7}
      />
      <Box
        position={[0, 2.99, 4.7]}
        size={[6.7, 0.2, 2.35]}
        color="#dad7c9"
        roughness={0.2}
      />
      <IslandDecor />
      {[-2, 0, 2].map((x) => (
        <group key={x} position={[x, 0, 6.6]}>
          <Box
            position={[0, 1.95, 0]}
            size={[1.25, 0.22, 1.1]}
            color="#ffffff"
            round={0.1}
            map={stool}
            roughness={0.62}
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
            <meshBasicMaterial color="#fff5e8" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Apartment({ quality }: { quality: Quality }) {
  // Real material crops from designs/public/location reference photos, not
  // procedural canvases — closes the fidelity gap on the room's biggest
  // surfaces (furniture wood, upholstery, rug) while the geometry itself
  // stays fully modeled (see the windows note below on why this apartment
  // never falls back to a flat background photo).
  const originalWood = useTexture("/textures/room-walnut.jpg");
  const wood = useMemo(() => {
    const t = originalWood.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [originalWood]);
  const originalFloor = useTexture("/textures/floor.jpg");
  const floor = useMemo(() => {
    const t = originalFloor.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // The replacement source is a square, straight-on plank texture, so an
    // even repeat keeps board widths consistent in both room directions.
    t.repeat.set(3, 3);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalFloor, quality]);
  const originalCouchFabric = useTexture("/textures/couch-fabric.jpg");
  const couchFabric = useMemo(() => {
    const t = originalCouchFabric.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [originalCouchFabric]);
  const originalRug = useTexture("/textures/room-rug.jpg");
  const rug = useMemo(() => {
    const t = originalRug.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 5);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [originalRug]);
  const originalSkyline = useTexture("/textures/seattle-skyline.jpg");
  const skyline = useMemo(() => {
    const t = originalSkyline.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [originalSkyline]);
  const originalCactus = useTexture("/textures/cactus.jpg");
  const cactus = useMemo(() => {
    const t = originalCactus.clone();
    // Sample an uninterrupted pad from the photograph so the white wall
    // never appears on the modeled leaves.
    t.offset.set(0.27, 0.35);
    t.repeat.set(0.11, 0.16);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [originalCactus]);
  const originalBooks = useTexture("/textures/bookshelf.jpg");
  const books = useMemo(() => {
    const t = originalBooks.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalBooks, quality]);
  const originalPaintings = useTexture("/textures/paintings.jpg");
  const paintings = useMemo(() => {
    const t = originalPaintings.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalPaintings, quality]);
  const originalIsland = useTexture("/textures/island.jpg");
  const island = useMemo(() => {
    const t = originalIsland.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalIsland, quality]);
  const originalTableTop = useTexture("/textures/table-top.jpg");
  const tableTop = useMemo(() => {
    const t = originalTableTop.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalTableTop, quality]);
  const originalPillow = useTexture("/textures/pillow-1.jpg");
  const pillow = useMemo(() => {
    const t = originalPillow.clone();
    t.offset.set(0.025, 0.045);
    t.repeat.set(0.95, 0.91);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalPillow, quality]);
  const originalPaintingTwo = useTexture("/textures/painting-2.png");
  const paintingTwo = useMemo(() => {
    const t = originalPaintingTwo.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalPaintingTwo, quality]);
  const originalStool = useTexture("/textures/stool.jpg");
  const stool = useMemo(() => {
    // Sample the white leather seat from the supplied stool photograph; the
    // modeled chrome base remains reflective geometry.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!ctx) throw new Error("Could not prepare the stool texture.");
    ctx.drawImage(
      originalStool.image as HTMLImageElement,
      340,
      245,
      320,
      105,
      0,
      0,
      512,
      512,
    );
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalStool, quality]);
  const originalCurtains = useTexture("/textures/curtains.jpg");
  const curtains = useMemo(() => {
    const t = originalCurtains.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = quality === "low" ? 2 : 8;
    return t;
  }, [originalCurtains, quality]);
  useEffect(
    () => () => {
      wood.dispose();
      floor.dispose();
      couchFabric.dispose();
      rug.dispose();
      skyline.dispose();
      cactus.dispose();
      books.dispose();
      paintings.dispose();
      island.dispose();
      tableTop.dispose();
      pillow.dispose();
      paintingTwo.dispose();
      stool.dispose();
      curtains.dispose();
    },
    [
      wood,
      floor,
      couchFabric,
      rug,
      skyline,
      cactus,
      books,
      paintings,
      island,
      tableTop,
      pillow,
      paintingTwo,
      stool,
      curtains,
    ],
  );
  return (
    <group>
      <Box
        position={[0, -2.73, 0]}
        size={[27, 0.25, 28]}
        color="#ffffff"
        map={floor}
        roughness={0.48}
      />
      <Box
        position={[0, -2.57, 0]}
        size={[13, 0.065, 11.5]}
        color="#8b8d83"
        map={rug}
        round={0.025}
      />
      {/* Wall tone colour-matched to designs/public/location's flat wall paint. */}
      <Box position={[0, 6, -13.7]} size={[27, 17.2, 0.3]} color="#d8d3c8" />
      <Box position={[13.5, 6, 0]} size={[0.3, 17.2, 28]} color="#ddd9cf" />
      <Box position={[0, 6, 13.7]} size={[27, 17.2, 0.3]} color="#d0cbc0" />
      {/* Large abstract artwork on the wall opposite the bookshelf. */}
      <Box
        position={[0, 6.4, 13.25]}
        size={[10.9, 7.4, 0.18]}
        color="#242421"
        roughness={0.32}
      />
      <mesh position={[0, 6.4, 13.14]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[10.5, 7]} />
        <meshBasicMaterial
          map={paintingTwo}
          color="#ffffff"
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Frameless paired artwork on the solid wall opposite the windows. */}
      <mesh
        position={[13.31, 6.5, -1.4]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[7.5, 5.2]} />
        <meshBasicMaterial
          map={paintings}
          color="#ffffff"
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Box position={[0, 14.65, 0]} size={[27, 0.25, 28]} color="#f1ece0" />
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
        <meshBasicMaterial color="#f5f1e9" />
      </mesh>
      {[-7, 0, 7].flatMap((x) =>
        [-8, 0, 8].map((z) => (
          <mesh
            key={`${x}-${z}`}
            position={[x, 14.37, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.18, 20]} />
            <meshBasicMaterial color="#fffaf1" side={THREE.DoubleSide} />
          </mesh>
        )),
      )}
      {/* Window glass remains physical; the city image sits beyond it. */}
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
      {/* Aspect-correct Seattle panorama behind the full open window wall. */}
      <mesh position={[-25, 5.7, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[36, 18.55]} />
        <meshBasicMaterial
          map={skyline}
          color="#ffffff"
          toneMapped={false}
          side={THREE.FrontSide}
        />
      </mesh>
      {/* Balcony slab and rail remain in front of the photographic distance. */}
      <Box position={[-17, -2, 0]} size={[7, 0.2, 28]} color="#979d92" />
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
                map={curtains}
                color="#ffffff"
                roughness={1}
              />
            </mesh>
          ))}
        </group>
      ))}
      <Sofa fabric={couchFabric} pillow={pillow} />
      <Kitchen island={island} stool={stool} />
      {/* Recessed built-in shelving behind the sectional. */}
      <group position={[-4.1, 0, -13.5]}>
        <Box
          position={[0, 0.89, 0.06]}
          size={[8.78, 6.99, 0.12]}
          color="#eceae3"
          roughness={0.82}
        />
        <Box
          position={[0, -2.465, 0.2]}
          size={[8.78, 0.28, 0.4]}
          color="#deddd7"
          roughness={0.72}
          round={0.025}
        />
        <mesh position={[0, 0.7, 0.17]} receiveShadow>
          <planeGeometry args={[8.4, 6.61]} />
          <meshStandardMaterial
            map={books}
            color="#ffffff"
            roughness={0.76}
          />
        </mesh>
      </group>
      <Plant position={[-9, -2.6, -7]} scale={1.6} cactus={cactus} />
      <Plant position={[9, -2.6, 5]} scale={1.3} cactus={cactus} />
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
          color="#fff0df"
          distance={10}
          decay={2}
        />
      </group>
      {/* Four physical places at the table. */}
      {[
        [0, 6.2, 0],
        [-6.2, 0, -Math.PI / 2],
        [6.2, 0, Math.PI / 2],
      ].map(([x, z, r], i) => (
        <group key={i} position={[x, -2.6, z]} rotation={[0, r, 0]}>
          <Box
            position={[0, 0.8, 0]}
            size={[2.6, 1.3, 2.2]}
            color="#ffffff"
            round={0.22}
            map={couchFabric}
          />
          <Box
            position={[0, 1.75, 1]}
            size={[2.6, 1.8, 0.4]}
            color="#ffffff"
            round={0.16}
            map={couchFabric}
          />
        </group>
      ))}
      {/* Coffee table: thin solid walnut top, chamfered edge and splayed legs. */}
      <Box
        position={[0, -0.19, 0]}
        size={[8.5, 0.36, 7.65]}
        color="#ffffff"
        map={tableTop}
        round={0.14}
        roughness={0.38}
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
    </group>
  );
}
