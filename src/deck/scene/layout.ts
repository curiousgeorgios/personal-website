import { Vector3 } from "three";

// The room, in units of roughly 10cm. y = 0 is the top of the console. Values from the agreed prototype.
export const FLOOR = -4.6;
export const SHELF_TOP = -3.63;
export const PLATTER = new Vector3(-1.55, 0.32, 0.05);
export const RECORD_Y = PLATTER.y + 0.14 + 0.011;
export const PIVOT = new Vector3(0.62, 0.32, -1.2);
export const ARM_LEN = 2.4;
export const ARM_UP = 0.64;
export const ARM_DOWN = 0.585;
export const CRATE = new Vector3(4.45, 0, -0.75);
export const CRATE_SIZE = { width: 3.5, depth: 2.3, wall: 0.09, floor: 0.1 };
export const SLEEVE = 3.05;
/** 33⅓ rpm in radians a second */
export const OMEGA = (2 * Math.PI * 100) / 3 / 60;
export const FLY_PEAK = 3.2;
/** The crate control sits on the console's front edge, under the crate */
export const HUD_ANCHOR = new Vector3(CRATE.x, 0, 2.6);

const FIRST_SLOT = CRATE_SIZE.depth / 2 - CRATE_SIZE.wall - 0.26;
const SLOT_SPAN = 1.3;

/** Records stand 0.33 apart, closer when there are more, so up to six always fit the crate */
export function slotZ(index: number, count: number): number {
  const spacing = count > 1 ? Math.min(0.33, SLOT_SPAN / (count - 1)) : 0;
  return FIRST_SLOT - index * spacing;
}

/** Records in front of the browsed one tip forward; the browsed one and those behind lean back (spec 5.4) */
export function tiltFor(index: number, browsed: number): number {
  return index < browsed ? 0.72 - 0.07 * index : -(0.1 + 0.012 * (index - browsed));
}

/** The arm angle at which the stylus first meets the record's lead-in groove */
export function playAngle(): number {
  for (let a = 0; a < 1.2; a += 0.002) {
    const x = PIVOT.x - ARM_LEN * Math.sin(a);
    const z = PIVOT.z + ARM_LEN * Math.cos(a);
    if (Math.hypot(x - PLATTER.x, z - PLATTER.z) < 1.34) return a;
  }
  return 0;
}
