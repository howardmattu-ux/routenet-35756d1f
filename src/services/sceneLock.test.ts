import { describe, it, expect } from "vitest";
import { isKenyanSeed, keepKenyanOnly } from "./sceneLock";

describe("Kenyan scene lock", () => {
  it("turns on for a Kenyan seed", () => {
    expect(isKenyanSeed({ title: "Genje Sana", artist: "Buruklyn Boyz" })).toBe(true);
  });
  it("stays off for global rap", () => {
    expect(isKenyanSeed({ title: "NOKIA", artist: "Drake" })).toBe(false);
  });
  it("drops Afrobeats, Bongo and Rhumba from a Kenyan queue", () => {
    const out = keepKenyanOnly([
      { artist: "Wakadinali" }, { artist: "Odumodublvck" }, { artist: "Rayvanny" },
      { artist: "Brymo" }, { artist: "Fally Ipupa" }, { artist: "Mejja, Ssaru" },
    ]);
    expect(out.map((o) => o.artist)).toEqual(["Wakadinali", "Mejja, Ssaru"]);
  });
});
