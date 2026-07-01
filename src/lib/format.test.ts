import { describe, it, expect } from "vitest";
import { formatKm, formatDuration, formatPace, paceMinPerKm, weekStart, shortDate } from "./format.ts";

describe("formatKm", () => {
  it("formate les mètres en km", () => {
    expect(formatKm(5000)).toBe("5.00 km");
    expect(formatKm(1234)).toBe("1.23 km");
  });
  it("renvoie — pour null/0", () => {
    expect(formatKm(null)).toBe("—");
    expect(formatKm(0)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("minutes sous une heure", () => {
    expect(formatDuration(600)).toBe("10 min");
  });
  it("heures + minutes au-delà", () => {
    expect(formatDuration(3660)).toBe("1h01");
  });
  it("renvoie — pour null/0", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatPace", () => {
  it("secondes/km -> m:ss/km", () => {
    expect(formatPace(311)).toBe("5:11/km");
    expect(formatPace(265)).toBe("4:25/km");
  });
  it("renvoie — pour 0/null", () => {
    expect(formatPace(0)).toBe("—");
    expect(formatPace(null)).toBe("—");
  });
});

describe("paceMinPerKm", () => {
  it("convertit en min/km numérique", () => {
    expect(paceMinPerKm(300)).toBe(5);
    expect(paceMinPerKm(null)).toBeNull();
  });
});

describe("weekStart", () => {
  it("renvoie le lundi à minuit", () => {
    const ws = weekStart(new Date("2026-07-01T15:30:00")); // mercredi
    expect(ws.getDay()).toBe(1); // lundi
    expect(ws.getHours()).toBe(0);
  });
});

describe("shortDate", () => {
  it("jj/mm", () => {
    expect(shortDate(new Date(2026, 6, 1))).toBe("01/07");
  });
});
