import { Object3D, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, test } from "vitest";
import { DESKTOP, PHONE, frame, toCanvas } from "../../src/deck/scene/framing";
import { CRATE, CRATE_SIZE, HUD_ANCHOR, SLEEVE, slotZ, tiltFor } from "../../src/deck/scene/layout";

const camera = () => new PerspectiveCamera(24, 1, 0.1, 200);

// The front record's sleeve on screen, placed as the scene places it
function coverHeight(cam: PerspectiveCamera, width: number, height: number) {
  const holder = new Object3D();
  holder.position.set(CRATE.x, CRATE_SIZE.floor, CRATE.z + slotZ(0, 4));
  holder.rotation.x = tiltFor(0, 0);
  holder.updateMatrixWorld();
  const ys = [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sy]) => toCanvas(holder.localToWorld(new Vector3((sx * SLEEVE) / 2, sy * SLEEVE, 0)), cam, width, height).y);
  return Math.max(...ys) - Math.min(...ys);
}

describe("framing", () => {
  test.each([[700, 472.5], [580, 391.5], [1000, 675]])("the desktop framing fits the whole room at %ipx wide", (width, height) => {
    const cam = camera();
    frame(cam, DESKTOP, width, height);
    for (const point of DESKTOP.points) {
      const p = toCanvas(point, cam, width, height);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
    }
  });

  test("on a 375px phone the cover is at least 90px tall and the control's anchor is inside the canvas (spec 5.2)", () => {
    const cam = camera();
    frame(cam, PHONE, 375, 320);
    expect(coverHeight(cam, 375, 320)).toBeGreaterThanOrEqual(90);
    const anchor = toCanvas(HUD_ANCHOR, cam, 375, 320);
    expect(anchor.x).toBeGreaterThan(0);
    expect(anchor.x).toBeLessThan(375);
    expect(anchor.y).toBeGreaterThan(0);
    expect(anchor.y).toBeLessThan(320);
  });

  test("the camera looks along the framing's direction", () => {
    const cam = camera();
    frame(cam, PHONE, 375, 320);
    expect(cam.getWorldDirection(new Vector3()).dot(PHONE.view)).toBeCloseTo(-1, 5);
  });
});
