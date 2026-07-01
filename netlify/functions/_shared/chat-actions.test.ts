import { describe, it, expect } from "vitest";
import { mightBeAction } from "./chat-actions.ts";

describe("mightBeAction (pré-filtre du classifieur)", () => {
  it("détecte une demande de plan", () => {
    expect(mightBeAction("crée-moi un plan pour un 10 km")).toBe(true);
  });
  it("détecte une blessure (mémoire)", () => {
    expect(mightBeAction("j'ai mal au genou depuis 2 jours")).toBe(true);
  });
  it("détecte une préférence à mémoriser", () => {
    expect(mightBeAction("retiens que je préfère courir le matin")).toBe(true);
  });
  it("détecte un repas", () => {
    expect(mightBeAction("ajoute mon déjeuner : riz et poulet")).toBe(true);
  });
  it("ignore une simple discussion", () => {
    expect(mightBeAction("Bonjour, tout va bien merci")).toBe(false);
    expect(mightBeAction("Il fait beau aujourd'hui")).toBe(false);
  });
});
