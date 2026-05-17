import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type ParentComponent,
} from "solid-js";
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ColorScheme, FontPref, Preferences, Theme } from "./types";
import { applyFonts, applyTokens } from "./apply";
import { validateTheme } from "./validate";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./builtin/index";

// ---------------------------------------------------------------------------
// Default preferences used before the persisted ones are loaded.
// ---------------------------------------------------------------------------
const FALLBACK_PREFS: Preferences = {
  themeId: DEFAULT_THEME_ID,
  colorScheme: "system",
  uiFont: { family: "sans-serif", sizePx: 14 },
  monoFont: { family: "monospace", sizePx: 13 },
};

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------
interface ThemeContextValue {
  preferences: Preferences;
  themes: () => Theme[];
  activeTheme: () => Theme;
  effectiveScheme: () => "light" | "dark";
  setTheme: (id: string) => void;
  setColorScheme: (s: ColorScheme) => void;
  setUiFont: (p: Partial<FontPref>) => void;
  setMonoFont: (p: Partial<FontPref>) => void;
  previewTheme: (id: string | null) => void;
  importTheme: () => Promise<{ ok: true; theme: Theme } | { ok: false; error: string }>;
  removeCustomTheme: (id: string) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function defaultTheme(): Theme {
  return BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? BUILTIN_THEMES[0];
}

function buildThemeList(custom: Theme[]): Theme[] {
  const fallback = defaultTheme();
  const builtinValidated = BUILTIN_THEMES.map((t) => validateTheme(t, fallback).theme);
  const customValidated = custom.map((t) => validateTheme(t, fallback).theme);
  return [...builtinValidated, ...customValidated];
}

function findTheme(list: Theme[], id: string): Theme {
  return list.find((t) => t.id === id) ?? list.find((t) => t.id === DEFAULT_THEME_ID) ?? list[0];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export const ThemeProvider: ParentComponent = (props) => {
  const [preferences, setPreferences] = createStore<Preferences>(FALLBACK_PREFS);
  const [themes, setThemes] = createSignal<Theme[]>(buildThemeList([]));

  // "system" scheme: track the OS preference reactively.
  // Guard: jsdom and some test environments do not implement matchMedia.
  const mql =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const [osDark, setOsDark] = createSignal(mql?.matches ?? false);
  const listener = (e: MediaQueryListEvent) => setOsDark(e.matches);
  mql?.addEventListener("change", listener);
  onCleanup(() => mql?.removeEventListener("change", listener));

  const effectiveScheme = (): "light" | "dark" => {
    if (preferences.colorScheme === "system") {
      return osDark() ? "dark" : "light";
    }
    return preferences.colorScheme;
  };

  const activeTheme = (): Theme => findTheme(themes(), preferences.themeId);

  // ---------------------------------------------------------------------------
  // Persist helper
  // ---------------------------------------------------------------------------
  function persist() {
    // Snapshot current store into a plain object before invoking.
    const snap: Preferences = {
      themeId: preferences.themeId,
      colorScheme: preferences.colorScheme,
      uiFont: { ...preferences.uiFont },
      monoFont: { ...preferences.monoFont },
    };
    void invoke<void>("set_preferences", { preferences: snap }).catch((e) =>
      console.error("[ThemeProvider] set_preferences failed:", e),
    );
  }

  // ---------------------------------------------------------------------------
  // Apply effect: re-apply whenever active theme / scheme / fonts change.
  // ---------------------------------------------------------------------------
  createEffect(() => {
    const scheme = effectiveScheme();
    const theme = activeTheme();
    const map = theme.modes[scheme];
    applyTokens(map);
    applyFonts(preferences.uiFont, preferences.monoFont);
  });

  // ---------------------------------------------------------------------------
  // Setters
  // ---------------------------------------------------------------------------
  function setTheme(id: string): void {
    setPreferences("themeId", id);
    persist();
  }

  function setColorScheme(s: ColorScheme): void {
    setPreferences("colorScheme", s);
    persist();
  }

  function setUiFont(p: Partial<FontPref>): void {
    setPreferences("uiFont", (prev) => ({ ...prev, ...p }));
    persist();
  }

  function setMonoFont(p: Partial<FontPref>): void {
    setPreferences("monoFont", (prev) => ({ ...prev, ...p }));
    persist();
  }

  // ---------------------------------------------------------------------------
  // Preview (transient, no store mutation, no persist)
  // ---------------------------------------------------------------------------
  function previewTheme(id: string | null): void {
    if (id === null) {
      // Revert to the persisted active theme.
      const scheme = effectiveScheme();
      const theme = activeTheme();
      applyTokens(theme.modes[scheme]);
    } else {
      const list = themes();
      const target = list.find((t) => t.id === id);
      if (!target) return;
      const scheme = effectiveScheme();
      applyTokens(target.modes[scheme]);
    }
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  async function importTheme(): Promise<
    { ok: true; theme: Theme } | { ok: false; error: string }
  > {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Theme JSON", extensions: ["json"] }],
        title: "Import a theme file",
      });
      if (!picked || typeof picked !== "string") {
        return { ok: false, error: "No file selected." };
      }
      const theme = await invoke<Theme>("import_theme_file", { path: picked });
      // Refresh the custom theme list from the backend.
      const custom = await invoke<Theme[]>("list_custom_themes");
      setThemes(buildThemeList(custom));
      return { ok: true, theme };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ---------------------------------------------------------------------------
  // Remove custom theme
  // ---------------------------------------------------------------------------
  async function removeCustomTheme(id: string): Promise<void> {
    try {
      await invoke<boolean>("remove_custom_theme", { id });
      const custom = await invoke<Theme[]>("list_custom_themes");
      setThemes(buildThemeList(custom));
      if (preferences.themeId === id) {
        setTheme(DEFAULT_THEME_ID);
      }
    } catch (e) {
      console.error("[ThemeProvider] removeCustomTheme failed:", e);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Mount: load preferences + custom themes, then apply.
  // ---------------------------------------------------------------------------
  onMount(async () => {
    const [prefs, custom] = await Promise.all([
      invoke<Preferences>("get_preferences"),
      invoke<Theme[]>("list_custom_themes"),
    ]);
    // Update store fields individually so Solid's granular reactivity fires.
    setPreferences("themeId", prefs.themeId);
    setPreferences("colorScheme", prefs.colorScheme);
    setPreferences("uiFont", prefs.uiFont);
    setPreferences("monoFont", prefs.monoFont);
    setThemes(buildThemeList(custom));
  });

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------
  const value: ThemeContextValue = {
    preferences,
    themes,
    activeTheme,
    effectiveScheme,
    setTheme,
    setColorScheme,
    setUiFont,
    setMonoFont,
    previewTheme,
    importTheme,
    removeCustomTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
