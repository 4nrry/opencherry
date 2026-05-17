import { describe, beforeEach, it, expect } from "vitest";
import { applyTokens, applyFonts } from "./apply";
import type { FontPref, TokenMap } from "./types";

describe("applyTokens", () => {
  beforeEach(() => {
    // Clear any properties set in previous tests
    document.documentElement.removeAttribute("style");
  });

  it("sets a single CSS custom property on documentElement", () => {
    const tokens: TokenMap = { "--color-bg-window": "#1a1a1a" };
    applyTokens(tokens);
    expect(
      document.documentElement.style.getPropertyValue("--color-bg-window"),
    ).toBe("#1a1a1a");
  });

  it("sets multiple CSS custom properties on documentElement", () => {
    const tokens: TokenMap = {
      "--color-text": "#e6e6e6",
      "--color-bg-card": "#2a2a2c",
      "--color-component-base": "#ffffff",
    };
    applyTokens(tokens);
    expect(
      document.documentElement.style.getPropertyValue("--color-text"),
    ).toBe("#e6e6e6");
    expect(
      document.documentElement.style.getPropertyValue("--color-bg-card"),
    ).toBe("#2a2a2c");
    expect(
      document.documentElement.style.getPropertyValue("--color-component-base"),
    ).toBe("#ffffff");
  });

  it("handles rgba values correctly", () => {
    const tokens: TokenMap = {
      "--color-component-hover": "rgba(255, 255, 255, 0.06)",
    };
    applyTokens(tokens);
    expect(
      document.documentElement.style.getPropertyValue("--color-component-hover"),
    ).toBe("rgba(255, 255, 255, 0.06)");
  });

  it("applies an empty token map without error", () => {
    expect(() => applyTokens({})).not.toThrow();
  });
});

describe("applyFonts", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("sets all four font CSS custom properties on documentElement", () => {
    const uiFont: FontPref = { family: "Inter", sizePx: 14 };
    const monoFont: FontPref = { family: "JetBrains Mono", sizePx: 13 };
    applyFonts(uiFont, monoFont);

    expect(
      document.documentElement.style.getPropertyValue("--font-ui"),
    ).toBe("Inter");
    expect(
      document.documentElement.style.getPropertyValue("--font-ui-size"),
    ).toBe("14px");
    expect(
      document.documentElement.style.getPropertyValue("--font-mono"),
    ).toBe("JetBrains Mono");
    expect(
      document.documentElement.style.getPropertyValue("--font-mono-size"),
    ).toBe("13px");
  });

  it("formats sizePx as a px string", () => {
    const uiFont: FontPref = { family: "System UI", sizePx: 16 };
    const monoFont: FontPref = { family: "Fira Code", sizePx: 12 };
    applyFonts(uiFont, monoFont);

    expect(
      document.documentElement.style.getPropertyValue("--font-ui-size"),
    ).toBe("16px");
    expect(
      document.documentElement.style.getPropertyValue("--font-mono-size"),
    ).toBe("12px");
  });
});
