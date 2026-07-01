import { describe, it, expect } from "vitest";
import { computeLoadBalance, loadText } from "./training-load.ts";

const NOW = new Date("2026-01-29T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

describe("computeLoadBalance (ACWR)", () => {
  it("renvoie null sans charge", () => {
    expect(computeLoadBalance([], NOW)).toBeNull();
    expect(computeLoadBalance([{ start_time: daysAgo(1), training_load: 0 }], NOW)).toBeNull();
  });

  it("calcule aiguë/chronique/ACWR/statut/tendance", () => {
    const acts = [
      { start_time: daysAgo(1), training_load: 200 }, // semaine courante
      { start_time: daysAgo(8), training_load: 100 }, // -1 sem
      { start_time: daysAgo(15), training_load: 100 }, // -2 sem
      { start_time: daysAgo(22), training_load: 100 }, // -3 sem
    ];
    const b = computeLoadBalance(acts, NOW)!;
    expect(b.acute_7d).toBe(200);
    expect(b.chronic_weekly).toBe(125); // (100+100+100+200)/4
    expect(b.acwr).toBe(1.6);
    expect(b.status).toBe("very_high"); // > 1.5
    expect(b.trend_pct).toBe(100); // 200 vs 100
    expect(b.weekly).toHaveLength(6);
  });

  it("classe une charge stable en zone optimale", () => {
    const acts = [0, 7, 14, 21].map((d) => ({ start_time: daysAgo(d), training_load: 100 }));
    const b = computeLoadBalance(acts, NOW)!;
    expect(b.acwr).toBe(1);
    expect(b.status).toBe("optimal");
  });

  it("ignore les activités hors fenêtre de 6 semaines", () => {
    const acts = [
      { start_time: daysAgo(2), training_load: 100 },
      { start_time: daysAgo(60), training_load: 999 }, // ignorée
    ];
    const b = computeLoadBalance(acts, NOW)!;
    expect(b.acute_7d).toBe(100);
  });
});

describe("loadText", () => {
  it("vide si non calculable", () => {
    expect(loadText(null)).toBe("");
  });
  it("résume le statut en français", () => {
    const b = computeLoadBalance(
      [0, 7, 14, 21].map((d) => ({ start_time: daysAgo(d), training_load: 100 })),
      NOW,
    );
    expect(loadText(b)).toContain("ACWR 1");
    expect(loadText(b)).toContain("optimale");
  });
});
