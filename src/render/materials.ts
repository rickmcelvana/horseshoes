// PBR materials from the CC0 texture set in public/textures (see CREDITS.md there).

import * as THREE from 'three';

export interface Materials {
  clay: THREE.MeshStandardMaterial;
  lawn: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
}

const loader = new THREE.TextureLoader();
/** Clones made with different tiling, which need re-uploading once the shared image arrives. */
const clones = new WeakMap<THREE.Texture, THREE.Texture[]>();

function load(name: string, srgb: boolean, repeat: [number, number], anisotropy: number): THREE.Texture {
  const t = loader.load(`${import.meta.env.BASE_URL}textures/${name}.jpg`, (tex) => {
    for (const c of clones.get(tex) ?? []) c.needsUpdate = true;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** albedo + normal + AO/roughness/metalness, all tiled the same. */
function pbr(name: string, repeat: [number, number], anisotropy: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  const arm = load(`${name}_arm`, false, repeat, anisotropy);
  return new THREE.MeshStandardMaterial({
    map: load(`${name}_diff`, true, repeat, anisotropy),
    normalMap: load(`${name}_nor`, false, repeat, anisotropy),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
    metalness: 1, // scaled by the map's blue channel (zero for these surfaces)
    ...extra,
  });
}

/** Textures load asynchronously; meshes render plain until they arrive. */
export function createMaterials(anisotropy: number): Materials {
  return {
    clay: pbr('clay', [1.5, 3], anisotropy, { normalScale: new THREE.Vector2(1.2, 1.2) }),
    lawn: pbr('lawn', [24, 36], anisotropy, { color: 0xb8c4a0 }),
    concrete: pbr('concrete', [1, 6], anisotropy),
    wood: pbr('wood', [1, 1], anisotropy),
    darkWood: pbr('wood', [1, 1], anisotropy, { color: 0x6d5a48 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 1, roughness: 0.32 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
  };
}

/** Set a wood material's tiling for a board of a given size (planks ~1 m square per tile). */
export function tiledClone(m: THREE.MeshStandardMaterial, u: number, v: number): THREE.MeshStandardMaterial {
  const c = m.clone();
  for (const key of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap'] as const) {
    const t = m[key];
    if (t) {
      const tc = t.clone();
      tc.repeat.set(u, v);
      if (t.image) tc.needsUpdate = true;
      else clones.set(t, [...(clones.get(t) ?? []), tc]);
      c[key] = tc;
    }
  }
  return c;
}
