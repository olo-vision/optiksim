/**
 * Virtueller Laborraum: reflektierender Boden, Raster, Podest, dezente Studio-Lichtleisten.
 * Maßstab: 1 Einheit = 1 mm.
 */
import { Grid, MeshReflectorMaterial } from '@react-three/drei';
import type { EnvironmentSettings } from '@/model/types';
import { theme3d } from '../theme3d';

export const FLOOR_Y = -230;

interface Props {
  settings: EnvironmentSettings;
  reflections: boolean;
  center: [number, number];
}

export function LabRoom({ settings, reflections, center }: Props) {
  const [cx, cz] = center;
  return (
    <group raycast={() => null}>
      <color attach="background" args={[theme3d.background]} />
      <fog attach="fog" args={[theme3d.background, 1100, 4200]} />

      {settings.showRoom && (
        <>
          {/* Boden */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, FLOOR_Y, cz]} receiveShadow>
            <planeGeometry args={[9000, 9000]} />
            {reflections ? (
              <MeshReflectorMaterial
                resolution={512}
                blur={[400, 120]}
                mixBlur={1}
                mixStrength={0.9}
                mixContrast={1}
                roughness={0.9}
                depthScale={0.6}
                minDepthThreshold={0.3}
                maxDepthThreshold={1.3}
                color={theme3d.floor}
                metalness={0.35}
                mirror={0.2}
              />
            ) : (
              <meshStandardMaterial color={theme3d.floor} roughness={0.85} metalness={0.2} />
            )}
          </mesh>

          {/* Podest mit Leuchtring */}
          <mesh position={[cx, FLOOR_Y + 3, cz]} receiveShadow castShadow>
            <cylinderGeometry args={[420, 432, 6, 128]} />
            <meshStandardMaterial color="#0b0d11" roughness={0.7} metalness={0.25} />
          </mesh>
          <mesh position={[cx, FLOOR_Y + 6.2, cz]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[400, 404, 160]} />
            <meshBasicMaterial color={theme3d.accent} transparent opacity={0.35} toneMapped={false} />
          </mesh>

          {/* Studio-Lichtleisten im Hintergrund */}
          {[-1, 0, 1].map((i) => (
            <mesh key={i} position={[cx + i * 900, FLOOR_Y + 700, cz + 2200]}>
              <planeGeometry args={[40, 1300]} />
              <meshBasicMaterial color="#cfe0f5" transparent opacity={0.22} toneMapped={false} fog={false} />
            </mesh>
          ))}
          {[-1, 1].map((i) => (
            <mesh key={`s${i}`} position={[cx + i * 2200, FLOOR_Y + 650, cz + 200]} rotation={[0, (-i * Math.PI) / 2, 0]}>
              <planeGeometry args={[2600, 26]} />
              <meshBasicMaterial color="#9cc8ff" transparent opacity={0.12} toneMapped={false} fog={false} />
            </mesh>
          ))}
        </>
      )}

      {settings.showGrid && (
        <Grid
          position={[cx, FLOOR_Y + (settings.showRoom ? 6.5 : 0.5), cz]}
          args={[10, 10]}
          cellSize={10}
          cellThickness={0.5}
          cellColor="#1b222b"
          sectionSize={100}
          sectionThickness={0.9}
          sectionColor="#2a3a4a"
          fadeDistance={2200}
          fadeStrength={1.6}
          infiniteGrid
        />
      )}
    </group>
  );
}
