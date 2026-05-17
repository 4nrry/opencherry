import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./context";
import type { Preferences, Theme } from "./types";
import { DEFAULT_THEME_ID } from "./builtin/index";

// ---------------------------------------------------------------------------
// Mock Tauri invoke + dialog open
// ---------------------------------------------------------------------------
const invokeMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

// ---------------------------------------------------------------------------
// jsdom does not implement window.matchMedia — provide a minimal stub.
// Individual tests that need to control the value override this stub.
// ---------------------------------------------------------------------------
function makeMatchMediaStub(matches: boolean) {
  return vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

// Default: system resolves to "light" (matches = false).
window.matchMedia = makeMatchMediaStub(false);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeTheme(id: string): Theme {
  const token = "--color-bg-window";
  return {
    id,
    name: id,
    modes: {
      light: { [token]: "#fff" },
      dark: { [token]: "#000" },
    },
  };
}

const DEFAULT_PREFS: Preferences = {
  themeId: DEFAULT_THEME_ID,
  colorScheme: "light",
  uiFont: {
    family: 'system-ui, -apple-system, "Segoe UI", "Cantarell", "Ubuntu", sans-serif',
    sizePx: 14,
  },
  monoFont: {
    family: 'ui-monospace, "JetBrains Mono", "Fira Code", monospace',
    sizePx: 13,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupInvoke(
  prefs: Preferences = DEFAULT_PREFS,
  custom: Theme[] = [],
) {
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    switch (command) {
      case "get_preferences":
        return Promise.resolve(prefs);
      case "list_custom_themes":
        return Promise.resolve(custom);
      case "set_preferences":
        return Promise.resolve();
      case "import_theme_file":
        return Promise.resolve(makeTheme("custom-imported"));
      case "remove_custom_theme":
        return Promise.resolve(true);
      default:
        throw new Error(`Unexpected invoke: ${command} ${JSON.stringify(payload)}`);
    }
  });
}

// Small helper component that captures the context value and exposes it.
let capturedCtx: ReturnType<typeof useTheme> | undefined;
function CaptureMountHelper() {
  capturedCtx = useTheme();
  return <></>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ThemeProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    capturedCtx = undefined;
  });

  it("loads preferences on mount and reflects them in the store", async () => {
    setupInvoke({ ...DEFAULT_PREFS, themeId: DEFAULT_THEME_ID, colorScheme: "dark" });

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    await waitFor(() => {
      expect(capturedCtx!.preferences.colorScheme).toBe("dark");
      expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID);
    });

    expect(invokeMock).toHaveBeenCalledWith("get_preferences");
    expect(invokeMock).toHaveBeenCalledWith("list_custom_themes");
  });

  it("setTheme updates store and persists via set_preferences", async () => {
    setupInvoke();

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    // Wait for mount to settle.
    await waitFor(() => expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID));

    // Now change the theme.
    capturedCtx!.setTheme("dracula");

    expect(capturedCtx!.preferences.themeId).toBe("dracula");

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_preferences", {
        preferences: expect.objectContaining({ themeId: "dracula" }),
      }),
    );
  });

  describe("effectiveScheme", () => {
    it("returns 'light' when colorScheme is 'light'", async () => {
      setupInvoke({ ...DEFAULT_PREFS, colorScheme: "light" });

      render(() => (
        <ThemeProvider>
          <CaptureMountHelper />
        </ThemeProvider>
      ));

      await waitFor(() => expect(capturedCtx!.preferences.colorScheme).toBe("light"));
      expect(capturedCtx!.effectiveScheme()).toBe("light");
    });

    it("returns 'dark' when colorScheme is 'dark'", async () => {
      setupInvoke({ ...DEFAULT_PREFS, colorScheme: "dark" });

      render(() => (
        <ThemeProvider>
          <CaptureMountHelper />
        </ThemeProvider>
      ));

      await waitFor(() => expect(capturedCtx!.preferences.colorScheme).toBe("dark"));
      expect(capturedCtx!.effectiveScheme()).toBe("dark");
    });

    it("resolves 'system' via window.matchMedia", async () => {
      // Simulate an OS dark mode preference (matches = true → dark).
      window.matchMedia = makeMatchMediaStub(true);

      setupInvoke({ ...DEFAULT_PREFS, colorScheme: "system" });

      render(() => (
        <ThemeProvider>
          <CaptureMountHelper />
        </ThemeProvider>
      ));

      await waitFor(() => expect(capturedCtx!.preferences.colorScheme).toBe("system"));
      expect(capturedCtx!.effectiveScheme()).toBe("dark");

      // Restore the default stub for subsequent tests.
      window.matchMedia = makeMatchMediaStub(false);
    });
  });

  it("previewTheme applies tokens without mutating the store or persisting", async () => {
    setupInvoke({ ...DEFAULT_PREFS, themeId: DEFAULT_THEME_ID });

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    await waitFor(() => expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID));

    const setPropertySpy = vi.spyOn(
      document.documentElement.style,
      "setProperty",
    );

    // Preview "dracula" — dracula is a built-in theme so it exists in the list.
    capturedCtx!.previewTheme("dracula");

    // Store must NOT have changed.
    expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID);

    // set_preferences must NOT have been called with a dracula themeId.
    const persistCalls = invokeMock.mock.calls.filter(
      (c) =>
        c[0] === "set_preferences" &&
        (c[1] as { preferences: Preferences }).preferences.themeId === "dracula",
    );
    expect(persistCalls).toHaveLength(0);

    // CSS setProperty must have been called (dracula applies some tokens).
    expect(setPropertySpy).toHaveBeenCalled();
    setPropertySpy.mockRestore();
  });

  it("importTheme calls the dialog, invokes import_theme_file, refreshes list, and returns ok:true", async () => {
    const customTheme = makeTheme("custom-imported");
    setupInvoke();

    // Override list_custom_themes to return the imported theme after import.
    let importDone = false;
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_preferences":
          return Promise.resolve(DEFAULT_PREFS);
        case "list_custom_themes":
          return Promise.resolve(importDone ? [customTheme] : []);
        case "set_preferences":
          return Promise.resolve();
        case "import_theme_file":
          importDone = true;
          return Promise.resolve(customTheme);
        default:
          throw new Error(`Unexpected invoke: ${command}`);
      }
    });

    openMock.mockResolvedValue("/some/path/custom.json");

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    await waitFor(() => expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID));

    const result = await capturedCtx!.importTheme();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.id).toBe("custom-imported");
      // warnings should always be present on a successful import (may be empty)
      expect(Array.isArray(result.warnings)).toBe(true);
    }

    expect(invokeMock).toHaveBeenCalledWith("import_theme_file", { path: "/some/path/custom.json" });

    // Theme list should now include the imported theme.
    await waitFor(() =>
      expect(capturedCtx!.themes().some((t) => t.id === "custom-imported")).toBe(true),
    );
  });

  it("importTheme returns warnings when the imported theme is missing tokens", async () => {
    // A theme with empty mode maps — validateTheme will warn about every missing token.
    const incompleteTheme: Theme = {
      id: "incomplete-theme",
      name: "Incomplete Theme",
      modes: { light: {}, dark: {} },
    };

    let importDone = false;
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_preferences":
          return Promise.resolve(DEFAULT_PREFS);
        case "list_custom_themes":
          return Promise.resolve(importDone ? [incompleteTheme] : []);
        case "set_preferences":
          return Promise.resolve();
        case "import_theme_file":
          importDone = true;
          return Promise.resolve(incompleteTheme);
        default:
          throw new Error(`Unexpected invoke: ${command}`);
      }
    });

    openMock.mockResolvedValue("/some/path/incomplete.json");

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    await waitFor(() => expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID));

    const result = await capturedCtx!.importTheme();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      // Each warning should mention the missing token and mode.
      expect(result.warnings.some((w) => w.includes("missing token"))).toBe(true);
    }
  });

  it("importTheme returns ok:false when the dialog is cancelled", async () => {
    setupInvoke();
    openMock.mockResolvedValue(null);

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    await waitFor(() => expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID));

    const result = await capturedCtx!.importTheme();

    expect(result.ok).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "import_theme_file",
      expect.anything(),
    );
  });

  it("removeCustomTheme refreshes the list and falls back to default when the active theme is removed", async () => {
    const customTheme = makeTheme("my-custom");

    let removed = false;
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_preferences":
          return Promise.resolve({ ...DEFAULT_PREFS, themeId: "my-custom" });
        case "list_custom_themes":
          return Promise.resolve(removed ? [] : [customTheme]);
        case "set_preferences":
          return Promise.resolve();
        case "remove_custom_theme":
          removed = true;
          return Promise.resolve(true);
        default:
          throw new Error(`Unexpected invoke: ${command}`);
      }
    });

    render(() => (
      <ThemeProvider>
        <CaptureMountHelper />
      </ThemeProvider>
    ));

    await waitFor(() => expect(capturedCtx!.preferences.themeId).toBe("my-custom"));

    await capturedCtx!.removeCustomTheme("my-custom");

    // The removed theme should be gone from the list.
    expect(capturedCtx!.themes().some((t) => t.id === "my-custom")).toBe(false);

    // The active theme should fall back to the default.
    await waitFor(() =>
      expect(capturedCtx!.preferences.themeId).toBe(DEFAULT_THEME_ID),
    );
  });
});
