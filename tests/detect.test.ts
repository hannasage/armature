import { describe, expect, it } from "vitest";
import { detectRefraction, readPreferences, type DetectionEnvironment } from "../src/core/detect";

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EDGE_UA = `${CHROME_UA} Edg/131.0.0.0`;
const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const IOS_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IOS_CHROME_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const FIREFOX_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";
const IOS_FIREFOX_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15";
const ANDROID_CHROME_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const OLD_EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19582";

const brands = (...names: string[]) => names.map((brand) => ({ brand, version: "131" }));

describe("detectRefraction", () => {
  it("accepts Chrome through userAgentData", () => {
    const env: DetectionEnvironment = { navigator: { userAgent: CHROME_UA, userAgentData: { brands: brands("Not_A Brand", "Chromium", "Google Chrome") } } };
    expect(detectRefraction(env)).toBe(true);
  });

  it("accepts Edge through userAgentData", () => {
    const env: DetectionEnvironment = { navigator: { userAgent: EDGE_UA, userAgentData: { brands: brands("Microsoft Edge", "Not?A_Brand") } } };
    expect(detectRefraction(env)).toBe(true);
  });

  it("accepts a bare Chromium brand, which Brave and Opera also report", () => {
    expect(detectRefraction({ navigator: { userAgentData: { brands: brands("Chromium", "Brave") } } })).toBe(true);
  });

  it("reads the brand list over a user agent that disagrees", () => {
    expect(detectRefraction({ navigator: { userAgent: CHROME_UA, userAgentData: { brands: brands("Some Other Browser") } } })).toBe(false);
  });

  it("falls back to the user agent when userAgentData has no brands", () => {
    expect(detectRefraction({ navigator: { userAgent: CHROME_UA, userAgentData: { brands: [] } } })).toBe(true);
    expect(detectRefraction({ navigator: { userAgent: CHROME_UA, userAgentData: {} } })).toBe(true);
  });

  it("accepts a Chrome or Edge user agent when userAgentData is absent", () => {
    expect(detectRefraction({ navigator: { userAgent: CHROME_UA } })).toBe(true);
    expect(detectRefraction({ navigator: { userAgent: EDGE_UA } })).toBe(true);
    expect(detectRefraction({ navigator: { userAgent: ANDROID_CHROME_UA } })).toBe(true);
  });

  it("rejects Safari on Mac and iPhone", () => {
    expect(detectRefraction({ navigator: { userAgent: SAFARI_UA } })).toBe(false);
    expect(detectRefraction({ navigator: { userAgent: IOS_SAFARI_UA } })).toBe(false);
  });

  it("rejects Chrome and Firefox on iOS, which are WebKit underneath", () => {
    expect(detectRefraction({ navigator: { userAgent: IOS_CHROME_UA } })).toBe(false);
    expect(detectRefraction({ navigator: { userAgent: IOS_FIREFOX_UA } })).toBe(false);
  });

  it("rejects Firefox", () => {
    expect(detectRefraction({ navigator: { userAgent: FIREFOX_UA } })).toBe(false);
  });

  it("rejects the old EdgeHTML engine", () => {
    expect(detectRefraction({ navigator: { userAgent: OLD_EDGE_UA } })).toBe(false);
  });

  it("is false when unsure: no navigator, an empty one, or a user agent that is not a string", () => {
    expect(detectRefraction({})).toBe(false);
    expect(detectRefraction({ navigator: undefined })).toBe(false);
    expect(detectRefraction({ navigator: {} })).toBe(false);
    expect(detectRefraction({ navigator: { userAgent: "" } })).toBe(false);
    expect(detectRefraction({ navigator: { userAgent: 42 as unknown as string } })).toBe(false);
    expect(detectRefraction({ navigator: { userAgentData: { brands: "Chromium" as unknown as [] } } })).toBe(false);
  });

  it("never asks the browser whether backdrop-filter url() is supported", () => {
    // Safari says yes and then draws nothing (WebKit bug 245510), so the detector must not read CSS support at all.
    let asked = 0;
    const env = { navigator: { userAgent: SAFARI_UA }, supports: () => { asked += 1; return true; } } as DetectionEnvironment;
    expect(detectRefraction(env)).toBe(false);
    expect(asked).toBe(0);
  });

  describe("overrides", () => {
    const safari: DetectionEnvironment = { navigator: { userAgent: SAFARI_UA } };
    const chrome: DetectionEnvironment = { navigator: { userAgent: CHROME_UA } };

    it("lets the data-lqg-refraction attribute on the root turn it on or off", () => {
      expect(detectRefraction({ ...safari, root: { getAttribute: (name) => (name === "data-lqg-refraction" ? "on" : null) } })).toBe(true);
      expect(detectRefraction({ ...chrome, root: { getAttribute: (name) => (name === "data-lqg-refraction" ? "off" : null) } })).toBe(false);
    });

    it("ignores an attribute that is not on or off", () => {
      expect(detectRefraction({ ...chrome, root: { getAttribute: () => "maybe" } })).toBe(true);
      expect(detectRefraction({ ...safari, root: { getAttribute: () => "" } })).toBe(false);
    });

    it("lets an explicit option beat the attribute and the browser", () => {
      const root = { getAttribute: () => "off" };
      expect(detectRefraction({ ...chrome, root }, { refraction: true })).toBe(true);
      expect(detectRefraction({ ...safari, root: { getAttribute: () => "on" } }, { refraction: false })).toBe(false);
      expect(detectRefraction(safari, { refraction: true })).toBe(true);
      expect(detectRefraction(chrome, { refraction: false })).toBe(false);
    });

    it("accepts the words on and off as the option", () => {
      expect(detectRefraction(safari, { refraction: "on" })).toBe(true);
      expect(detectRefraction(chrome, { refraction: "off" })).toBe(false);
      expect(detectRefraction(chrome, { refraction: "auto" })).toBe(true);
    });

    it("survives a root whose getAttribute throws", () => {
      const root = { getAttribute: () => { throw new Error("detached"); } };
      expect(detectRefraction({ ...chrome, root })).toBe(true);
    });
  });
});

describe("readPreferences", () => {
  const media = (active: string[]) => (query: string) => ({ matches: active.some((part) => query.includes(part)) });

  it("reads reduced motion, reduced transparency, and forced colors", () => {
    expect(readPreferences({ matchMedia: media(["prefers-reduced-motion"]) })).toEqual({ reducedMotion: true, reducedTransparency: false, forcedColors: false });
    expect(readPreferences({ matchMedia: media(["prefers-reduced-transparency"]) })).toEqual({ reducedMotion: false, reducedTransparency: true, forcedColors: false });
    expect(readPreferences({ matchMedia: media(["forced-colors"]) })).toEqual({ reducedMotion: false, reducedTransparency: false, forcedColors: true });
  });

  it("asks the exact media queries", () => {
    const asked: string[] = [];
    readPreferences({ matchMedia: (query) => { asked.push(query); return { matches: false }; } });
    expect(asked.sort()).toEqual(["(forced-colors: active)", "(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)"]);
  });

  it("is all false with no matchMedia, as on the server or in Safari for transparency", () => {
    expect(readPreferences({})).toEqual({ reducedMotion: false, reducedTransparency: false, forcedColors: false });
  });

  it("treats a throwing matchMedia as false", () => {
    const env = { matchMedia: () => { throw new Error("nope"); } };
    expect(readPreferences(env)).toEqual({ reducedMotion: false, reducedTransparency: false, forcedColors: false });
  });
});
