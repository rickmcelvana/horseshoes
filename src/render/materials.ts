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
/** Work waiting for a texture's image (cloning one before then makes three.js warn). */
const pending = new WeakMap<THREE.Texture, (() => void)[]>();

function whenLoaded(t: THREE.Texture, f: () => void) {
  if (t.image) f();
  else pending.set(t, [...(pending.get(t) ?? []), f]);
}

function load(name: string, srgb: boolean, repeat: [number, number], anisotropy: number): THREE.Texture {
  const t = loader.load(`${import.meta.env.BASE_URL}textures/${name}.jpg`, (tex) => {
    for (const f of pending.get(tex) ?? []) f();
    pending.delete(tex);
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
      // Until the image arrives the shared texture stands in, tiled the default way.
      whenLoaded(t, () => {
        const tc = t.clone();
        tc.repeat.set(u, v);
        c[key] = tc;
      });
    }
  }
  return c;
}
