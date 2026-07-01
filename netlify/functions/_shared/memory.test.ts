import { describe, it, expect } from "vitest";
import { memoryText } from "./memory.ts";

describe("memoryText", () => {
  it("vide si aucune mémoire", () => {
    expect(memoryText([])).toBe("");
  });

  it("groupe par catégorie et respecte l'ordre", () => {
    const txt = memoryText([
      { category: "blessure", content: "Genou droit sensible" },
      { category: "objectif", content: "Semi en 1h30" },
    ]);
    expect(txt).toContain("Objectifs");
    expect(txt).toContain("Semi en 1h30");
    expect(txt).toContain("Blessures / santé");
    // Objectifs listés avant Blessures
    expect(txt.indexOf("Objectifs")).toBeLessThan(txt.indexOf("Blessures"));
  });

  it("range une catégorie inconnue sous Divers", () => {
    const txt = memoryText([{ category: "n_importe_quoi", content: "note libre" }]);
    expect(txt).toContain("Divers");
    expect(txt).toContain("note libre");
  });
});
