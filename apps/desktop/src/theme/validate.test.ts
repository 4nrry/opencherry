import { describe, it, expect } from "vitest";
import { validateTheme } from "./validate";
import type { Theme } from "./types";
import { COLOR_TOKENS } from "./tokens";
import openCherryDefault from "./builtin/opencherry-default.json";

const fallback = openCherryDefault as Theme;

function makeCompleteTheme(id = "test-theme", name = "Test Theme"): Theme {
  return {
    id,
    name,
    modes: {
      light: { ...fallback.modes.light },
      dark: { ...fallback.modes.dark },
    },
  };
}

describe("validateTheme — complete theme", () => {
  it("returns no warnings when all 21 tokens are present in both modes", () => {
    const theme = makeCompleteTheme();
    const { warnings } = validateTheme(theme, fallback);
    expect(warnings).toHaveLength(0);
  });

  it("returns the theme unchanged when complete", () => {
    const theme = makeCompleteTheme();
    const { theme: result } = validateTheme(theme, fallback);
    expect(result.id).toBe("test-theme");
    expect(result.name).toBe("Test Theme");
    expect(Object.keys(result.modes.light)).toHaveLength(COLOR_TOKENS.length);
    expect(Object.keys(result.modes.dark)).toHaveLength(COLOR_TOKENS.length);
  });
});

describe("validateTheme — missing tokens", () => {
  it("fills a missing light-mode token from the fallback and records a warning", () => {
    const theme = makeCompleteTheme();
    delete (theme.modes.light as Record<string, string>)["--color-bg-window"];

    const { theme: result, warnings } = validateTheme(theme, fallback);

    expect(result.modes.light["--color-bg-window"]).toBe(
      fallback.modes.light["--color-bg-window"],
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("--color-bg-window"))).toBe(true);
    expect(warnings.some((w) => w.includes("light"))).toBe(true);
  });

  it("fills a missing dark-mode token from the fallback and records a warning", () => {
    const theme = makeCompleteTheme();
    delete (theme.modes.dark as Record<string, string>)["--color-text"];

    const { theme: result, warnings } = validateTheme(theme, fallback);

    expect(result.modes.dark["--color-text"]).toBe(
      fallback.modes.dark["--color-text"],
    );
    expect(warnings.some((w) => w.includes("--color-text"))).toBe(true);
    expect(warnings.some((w) => w.includes("dark"))).toBe(true);
  });

  it("fills multiple missing tokens across both modes", () => {
    const theme = makeCompleteTheme();
    const missingLight = ["--color-warn-fg", "--color-ok-bg"];
    const missingDark = ["--color-danger-fg", "--color-agent-active"];

    for (const token of missingLight) {
      delete (theme.modes.light as Record<string, string>)[token];
    }
    for (const token of missingDark) {
      delete (theme.modes.dark as Record<string, string>)[token];
    }

    const { theme: result, warnings } = validateTheme(theme, fallback);

    for (const token of missingLight) {
      expect(result.modes.light[token]).toBe(fallback.modes.light[token]);
    }
    for (const token of missingDark) {
      expect(result.modes.dark[token]).toBe(fallback.modes.dark[token]);
    }
    expect(warnings.length).toBeGreaterThanOrEqual(4);
  });

  it("does not mutate the original theme object", () => {
    const theme = makeCompleteTheme();
    delete (theme.modes.light as Record<string, string>)["--color-bg-sidebar"];

    validateTheme(theme, fallback);

    // Original should still be missing the token
    expect("--color-bg-sidebar" in theme.modes.light).toBe(false);
  });
});

describe("validateTheme — id and name validation", () => {
  it("warns when id is an empty string", () => {
    const theme = makeCompleteTheme("");
    const { warnings } = validateTheme(theme, fallback);
    expect(warnings.some((w) => w.toLowerCase().includes("id"))).toBe(true);
  });

  it("warns when name is an empty string", () => {
    const theme = makeCompleteTheme("valid-id", "");
    const { warnings } = validateTheme(theme, fallback);
    expect(warnings.some((w) => w.toLowerCase().includes("name"))).toBe(true);
  });

  it("produces no id/name warnings for a valid theme", () => {
    const theme = makeCompleteTheme("my-theme", "My Theme");
    const { warnings } = validateTheme(theme, fallback);
    const idOrNameWarnings = warnings.filter(
      (w) =>
        (w.toLowerCase().includes("id") ||
          w.toLowerCase().includes("name")) &&
        !w.includes("--color"),
    );
    expect(idOrNameWarnings).toHaveLength(0);
  });
});

describe("validateTheme — all builtin themes are complete", () => {
  it("each builtin theme validates with zero warnings against the fallback", async () => {
    const { BUILTIN_THEMES } = await import("./builtin/index");
    for (const theme of BUILTIN_THEMES) {
      const { warnings } = validateTheme(theme, fallback);
      expect(warnings, `theme "${theme.id}" should have no warnings`).toHaveLength(0);
    }
  });
});
