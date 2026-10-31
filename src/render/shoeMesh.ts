import * as THREE from 'three';
import { SHOE, barPolygon, shoeOutline } from '../rules';

export const SHOE_COLORS = [0xc8452d, 0x2d6ec8] as const;

let geometry: THREE.BufferGeometry | null = null;

/** The bar, extruded from the same outline the rules engine measures. */
function barGeometry(): THREE.BufferGeometry {
  if (geometry) return geometry;
  const poly = barPolygon(shoeOutline(true));
  // Shape lives in XY; after rotating -90° about X, shape y becomes -local z.
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: SHOE.barThickness,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.001,
    bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -SHOE.barThickness / 2, 0);
  g.computeVertexNormals();
  geometry = g;
  return g;
}

export function createShoeMesh(owner: 0 | 1): THREE.Group {
  const steel = new THREE.MeshStandardMaterial({ color: 0x77736c, metalness: 0.8, roughness: 0.45 });
  const paint = new THREE.MeshStandardMaterial({ color: SHOE_COLORS[owner], metalness: 0.2, roughness: 0.6 });
  const group = new THREE.Group();
  const bar = new THREE.Mesh(barGeometry(), [paint, steel]);
  bar.castShadow = true;
  group.add(bar);

  const t = SHOE.barThickness;
  const cy = -(t / 2 + SHOE.calkDepth / 2);
  const calk = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, SHOE.calkDepth, d), steel);
    m.position.set(x, cy, z);
    m.castShadow = true;
    group.add(m);
  };
  for (const z of [-SHOE.pointHalfSpacing, SHOE.pointHalfSpacing]) {
    calk(SHOE.heelCalkLength, SHOE.barWidth, -SHOE.legLength + SHOE.heelCalkLength / 2, z);
  }
  calk(SHOE.barWidth, SHOE.toeCalkSpan, SHOE.toeRadius, 0);
  return group;
}
