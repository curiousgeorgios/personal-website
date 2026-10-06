import { Box3, Vector3, type PerspectiveCamera } from "three";
import { FLOOR } from "./layout";

export interface Framing {
  points: Vector3[];
  view: Vector3;
}

const corners = (min: Vector3, max: Vector3) =>
  [...Array(8)].map((_, i) => new Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z));

/** Desktop: the whole console, its shelf and the rug */
export const DESKTOP: Framing = {
  points: corners(new Vector3(-3.9, FLOOR, -2.7), new Vector3(7.0, 4.1, 2.9)).concat([new Vector3(-2.6, FLOOR, 4.7), new Vector3(5.4, FLOOR, 4.7)]),
  view: new Vector3(0, 0.62, 1).normalize(),
};

/** Phones: cropped to the console top (turntable, candle and crate), with the shelf and rug only peeking in */
export const PHONE: Framing = {
  points: corners(new Vector3(-3.35, -0.9, -2.0), new Vector3(6.25, 3.4, 2.7)),
  view: new Vector3(0, 0.45, 1).normalize(),
};

/** Backs the camera away along the framing's direction until every point fits, by binary search, so any aspect works */
export function frame(camera: PerspectiveCamera, framing: Framing, width: number, height: number): void {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const focus = new Box3().setFromPoints(framing.points).getCenter(new Vector3());
  const place = (distance: number) => {
    camera.position.copy(focus).addScaledVector(framing.view, distance);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  };
  const p = new Vector3();
  let near = 5;
  let far = 200;
  for (let k = 0; k < 30; k++) {
    const distance = (near + far) / 2;
    place(distance);
    const fits = framing.points.every((point) => {
      p.copy(point).project(camera);
      return Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.95;
    });
    if (fits) far = distance;
    else near = distance;
  }
  place(far);
}

/** CSS pixel position of a world point in a canvas of this size */
export function toCanvas(point: Vector3, camera: PerspectiveCamera, width: number, height: number): { x: number; y: number } {
  const p = point.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height };
}
