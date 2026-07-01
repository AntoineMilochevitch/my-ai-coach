import { describe, it, expect } from "vitest";
import { plausibleRunSpeedMps, paceFromVdot } from "./zones.ts";

describe("plausibleRunSpeedMps", () => {
  it("corrige le facteur 10 de Garmin (0.378 -> 3.78 m/s)", () => {
    const v = plausibleRunSpeedMps(0.37777672);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(3.7778, 3);
  });
  it("garde une vitesse m/s déjà plausible", () => {
    expect(plausibleRunSpeedMps(3.78)).toBeCloseTo(3.78, 5);
  });
  it("convertit depuis des km/h", () => {
    // 15 km/h -> 4.1667 m/s
    expect(plausibleRunSpeedMps(15)).toBeCloseTo(15 / 3.6, 4);
  });
  it("rejette une valeur ininterprétable", () => {
    expect(plausibleRunSpeedMps(0.05)).toBeNull();
  });
});

describe("paceFromVdot", () => {
  it("VDOT 56 au seuil (~0.87) ≈ 3:55/km", () => {
    const s = paceFromVdot(56, 0.87);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(225);
    expect(s!).toBeLessThan(245);
  });
  it("un VDOT plus élevé donne une allure plus rapide", () => {
    expect(paceFromVdot(60, 0.87)!).toBeLessThan(paceFromVdot(50, 0.87)!);
  });
  it("une fraction plus élevée (plus intense) donne une allure plus rapide", () => {
    expect(paceFromVdot(56, 0.97)!).toBeLessThan(paceFromVdot(56, 0.7)!);
  });
});
