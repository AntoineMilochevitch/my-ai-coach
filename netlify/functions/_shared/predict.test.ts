import { describe, it, expect } from "vitest";
import { predictRaces } from "./predict.ts";

describe("predictRaces (VDOT / Daniels)", () => {
  const races = predictRaces(56);

  it("renvoie les 4 distances standard", () => {
    expect(races.map((r) => r.distance_m)).toEqual([5000, 10000, 21097, 42195]);
  });

  it("VDOT 56 : 5 km réaliste (~18:05)", () => {
    const five = races.find((r) => r.distance_m === 5000)!;
    expect(five.time_s).toBeGreaterThan(1040); // 17:20
    expect(five.time_s).toBeLessThan(1130); // 18:50
  });

  it("le temps augmente avec la distance", () => {
    for (let i = 1; i < races.length; i++) {
      expect(races[i].time_s).toBeGreaterThan(races[i - 1].time_s);
    }
  });

  it("l'allure ralentit avec la distance (marathon plus lent que 5 km)", () => {
    const five = races.find((r) => r.distance_m === 5000)!;
    const mar = races.find((r) => r.distance_m === 42195)!;
    expect(mar.pace_s_per_km).toBeGreaterThan(five.pace_s_per_km);
  });

  it("un meilleur VDOT donne un 5 km plus rapide", () => {
    const fast = predictRaces(60).find((r) => r.distance_m === 5000)!;
    const slow = predictRaces(50).find((r) => r.distance_m === 5000)!;
    expect(fast.time_s).toBeLessThan(slow.time_s);
  });
});
