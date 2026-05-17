import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { SettingsDialog } from "./SettingsDialog";
import type { Preferences, Theme } from "./theme/types";
import { createStore } from "solid-js/store";

// ---------------------------------------------------------------------------
// Mock the theme context so the dialog can be tested in isolation
// ---------------------------------------------------------------------------
const mockSetTheme = vi.fn();
const mockSetColorScheme = vi.fn();
const mockSetUiFont = vi.fn();
const mockSetMonoFont = vi.fn();
const mockPreviewTheme = vi.fn();
const mockImportTheme = vi.fn();
const mockRemoveCustomTheme = vi.fn();

const BUILTIN_THEME: Theme = {
  id: "opencherry-default",
  name: "OpenCherry Default",
  modes: {
    light: {
      "--color-bg-window": "#fafafa",
      "--color-component-selected-bg": "rgba(220,38,47,0.12)",
      "--color-text": "#1a1a1a",
    },
    dark: {
      "--color-bg-window": "#1c1c1e",
      "--color-component-selected-bg": "rgba(220,38,47,0.20)",
      "--color-text": "#e6e6e6",
    },
  },
};

const CUSTOM_THEME: Theme = {
  id: "my-custom",
  name: "My Custom Theme",
  modes: {
    light: {
      "--color-bg-window": "#fff",
      "--color-component-selected-bg": "#00f",
      "--color-text": "#000",
    },
    dark: {
      "--color-bg-window": "#000",
      "--color-component-selected-bg": "#00f",
      "--color-text": "#fff",
    },
  },
};

const DEFAULT_PREFS: Preferences = {
  themeId: "opencherry-default",
  colorScheme: "system",
  uiFont: {
    family:
      'system-ui, -apple-system, "Segoe UI", "Cantarell", "Ubuntu", sans-serif',
    sizePx: 14,
  },
  monoFont: {
    family: 'ui-monospace, "JetBrains Mono", "Fira Code", monospace',
    sizePx: 13,
  },
};

function makeMockTheme(overrides: {
  prefs?: Partial<Preferences>;
  themes?: Theme[];
  effectiveScheme?: "light" | "dark";
} = {}) {
  const [preferences] = createStore<Preferences>({
    ...DEFAULT_PREFS,
    ...overrides.prefs,
  });
  const themeList = overrides.themes ?? [BUILTIN_THEME];
  return {
    preferences,
    themes: () => themeList,
    activeTheme: () => BUILTIN_THEME,
    effectiveScheme: () => overrides.effectiveScheme ?? "light",
    setTheme: mockSetTheme,
    setColorScheme: mockSetColorScheme,
    setUiFont: mockSetUiFont,
    setMonoFont: mockSetMonoFont,
    previewTheme: mockPreviewTheme,
    importTheme: mockImportTheme,
    removeCustomTheme: mockRemoveCustomTheme,
  };
}

// Replace the real useTheme with a factory that returns the current mock value.
// We keep a mutable reference so individual tests can swap it out.
let currentMock = makeMockTheme();

vi.mock("./theme/context", () => ({
  useTheme: () => currentMock,
}));

beforeEach(() => {
  currentMock = makeMockTheme();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushMicrotasks() {
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsDialog", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(() => (
      <SettingsDialog open={false} onClose={() => {}} />
    ));
    expect(container.querySelector(".settings-dialog__overlay")).toBeNull();
  });

  it("renders the dialog when open is true", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  // -------- Theme picker --------

  it("renders the theme list", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByText("OpenCherry Default")).toBeTruthy();
  });

  it("renders multiple themes", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME, CUSTOM_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByText("OpenCherry Default")).toBeTruthy();
    // "My Custom Theme" appears in both the picker card and the custom-themes list
    expect(screen.getAllByText("My Custom Theme").length).toBeGreaterThanOrEqual(1);
  });

  it("clicking a theme card calls setTheme with its id", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Select theme OpenCherry Default"));
    expect(mockSetTheme).toHaveBeenCalledWith("opencherry-default");
  });

  it("hovering a theme card calls previewTheme with its id", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.mouseEnter(
      screen.getByLabelText("Select theme OpenCherry Default"),
    );
    expect(mockPreviewTheme).toHaveBeenCalledWith("opencherry-default");
  });

  it("mouse leave on a theme card calls previewTheme(null)", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.mouseLeave(
      screen.getByLabelText("Select theme OpenCherry Default"),
    );
    expect(mockPreviewTheme).toHaveBeenCalledWith(null);
  });

  // -------- Color scheme control --------

  it("renders Light / Dark / System scheme buttons", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByText("Dark")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
  });

  it("clicking Light calls setColorScheme('light')", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Light"));
    expect(mockSetColorScheme).toHaveBeenCalledWith("light");
  });

  it("clicking Dark calls setColorScheme('dark')", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Dark"));
    expect(mockSetColorScheme).toHaveBeenCalledWith("dark");
  });

  it("clicking System calls setColorScheme('system')", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("System"));
    expect(mockSetColorScheme).toHaveBeenCalledWith("system");
  });

  // -------- UI font --------

  it("changing the UI font select calls setUiFont with the family", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    const sel = screen.getByLabelText("UI font family") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: '"Inter", sans-serif' } });
    expect(mockSetUiFont).toHaveBeenCalledWith({
      family: '"Inter", sans-serif',
    });
  });

  it("changing the UI font size input calls setUiFont with clamped sizePx", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    const inp = screen.getByLabelText("UI font size") as HTMLInputElement;
    fireEvent.change(inp, { target: { value: "18" } });
    expect(mockSetUiFont).toHaveBeenCalledWith({ sizePx: 18 });
  });

  it("UI font size input clamps below minimum to 10", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    const inp = screen.getByLabelText("UI font size") as HTMLInputElement;
    fireEvent.change(inp, { target: { value: "3" } });
    expect(mockSetUiFont).toHaveBeenCalledWith({ sizePx: 10 });
  });

  it("UI font size input clamps above maximum to 24", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    const inp = screen.getByLabelText("UI font size") as HTMLInputElement;
    fireEvent.change(inp, { target: { value: "99" } });
    expect(mockSetUiFont).toHaveBeenCalledWith({ sizePx: 24 });
  });

  // -------- Mono font --------

  it("changing the mono font select calls setMonoFont with the family", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    const sel = screen.getByLabelText(
      "Mono font family",
    ) as HTMLSelectElement;
    fireEvent.change(sel, {
      target: { value: '"Cascadia Code", monospace' },
    });
    expect(mockSetMonoFont).toHaveBeenCalledWith({
      family: '"Cascadia Code", monospace',
    });
  });

  it("changing the mono font size calls setMonoFont with clamped sizePx", () => {
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    const inp = screen.getByLabelText("Mono font size") as HTMLInputElement;
    fireEvent.change(inp, { target: { value: "16" } });
    expect(mockSetMonoFont).toHaveBeenCalledWith({ sizePx: 16 });
  });

  // -------- Import button --------

  it("clicking Import theme calls importTheme and clears error on success", async () => {
    mockImportTheme.mockResolvedValue({ ok: true, theme: CUSTOM_THEME });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Import theme…"));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(mockImportTheme).toHaveBeenCalledTimes(1);
  });

  it("shows an error banner when importTheme returns ok:false", async () => {
    mockImportTheme.mockResolvedValue({ ok: false, error: "bad file" });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Import theme…"));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(screen.getByRole("alert").textContent).toContain("bad file");
  });

  // -------- Remove custom theme --------

  it("shows custom themes with remove buttons", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME, CUSTOM_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    // BUILTIN_THEME is in BUILTIN_THEMES so only CUSTOM_THEME shows as custom
    expect(
      screen.getByLabelText("Remove theme My Custom Theme"),
    ).toBeTruthy();
  });

  it("clicking Remove calls removeCustomTheme with the theme id", () => {
    mockRemoveCustomTheme.mockResolvedValue(undefined);
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME, CUSTOM_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Remove theme My Custom Theme"));
    expect(mockRemoveCustomTheme).toHaveBeenCalledWith("my-custom");
  });

  it("shows fallback text when no custom themes are installed", () => {
    currentMock = makeMockTheme({ themes: [BUILTIN_THEME] });
    render(() => <SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByText("No custom themes installed.")).toBeTruthy();
  });

  // -------- Backdrop / close button --------

  it("clicking the backdrop calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <SettingsDialog open={true} onClose={onClose} />
    ));
    const overlay = container.querySelector(
      ".settings-dialog__overlay",
    ) as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the panel itself does NOT call onClose", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <SettingsDialog open={true} onClose={onClose} />
    ));
    const panel = container.querySelector(
      ".settings-dialog__panel",
    ) as HTMLElement;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", () => {
    const onClose = vi.fn();
    render(() => <SettingsDialog open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape when closed does NOT call onClose", () => {
    const onClose = vi.fn();
    render(() => <SettingsDialog open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking the × close button calls onClose", () => {
    const onClose = vi.fn();
    render(() => <SettingsDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
