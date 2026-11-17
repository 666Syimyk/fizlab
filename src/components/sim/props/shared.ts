import * as THREE from "three";

/**
 * Module-level cache for geometries that many prop instances share (car body
 * extrusions, lathe profiles...). Built once on first use, reused across scenes.
 */
const shared = new Map<string, unknown>();

export function sharedResource<T>(key: string, build: () => T): T {
  if (!shared.has(key)) shared.set(key, build());
  return shared.get(key) as T;
}

export function extrudeProfile(key: string, points: [number, number][], depth: number, bevel = 0.04): THREE.ExtrudeGeometry {
  return sharedResource(`extrude-${key}`, () => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 8,
    });
    geometry.translate(0, 0, -depth / 2);
    geometry.computeVertexNormals();
    return geometry;
  });
}

export function latheProfile(key: string, points: [number, number][], segments = 32): THREE.LatheGeometry {
  return sharedResource(`lathe-${key}`, () => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments));
}

/** Map a wavelength (nm) to an sRGB hex color (visible 380–750 nm). */
export function wavelengthToColor(nm: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 750) {
    r = 1;
  } else {
    r = 0.6;
  }
  if (nm < 380) {
    r = 0.55;
    b = 0.9;
  }
  const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
}
