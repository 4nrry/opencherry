import {
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useTheme } from "./theme/context";
import { BUILTIN_THEMES } from "./theme/builtin/index";
import type { ColorScheme } from "./theme/types";

// ---------------------------------------------------------------------------
// Curated font lists
// ---------------------------------------------------------------------------

const UI_FONTS: { label: string; value: string }[] = [
  {
    label: "System UI (default)",
    value:
      'system-ui, -apple-system, "Segoe UI", "Cantarell", "Ubuntu", sans-serif',
  },
  { label: "Inter", value: '"Inter", sans-serif' },
  { label: "Geist", value: '"Geist", sans-serif' },
  { label: "Roboto", value: '"Roboto", sans-serif' },
  { label: "SF Pro", value: '"SF Pro Display", "SF Pro Text", sans-serif' },
  {
    label: "Noto Sans",
    value: '"Noto Sans", "Noto Sans CJK", sans-serif',
  },
];

const MONO_FONTS: { label: string; value: string }[] = [
  {
    label: "JetBrains Mono / Fira Code (default)",
    value: 'ui-monospace, "JetBrains Mono", "Fira Code", monospace',
  },
  { label: "Cascadia Code", value: '"Cascadia Code", monospace' },
  { label: "Hack", value: '"Hack", monospace' },
  { label: "Source Code Pro", value: '"Source Code Pro", monospace' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", monospace' },
  { label: "Iosevka", value: '"Iosevka", monospace' },
];

// ---------------------------------------------------------------------------
// Swatch token names sampled from each theme
// ---------------------------------------------------------------------------
const SWATCH_TOKENS = [
  "--color-bg-window",
  "--color-component-selected-bg",
  "--color-text",
] as const;

// ---------------------------------------------------------------------------
// Color-scheme segmented control options
// ---------------------------------------------------------------------------
const SCHEME_OPTIONS: { label: string; value: ColorScheme }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
];

const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsDialog(props: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const theme = useTheme();
  const [importError, setImportError] = createSignal<string | null>(null);

  // Escape key handler
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const handleImport = async () => {
    setImportError(null);
    const result = await theme.importTheme();
    if (!result.ok) {
      setImportError(result.error);
    }
  };

  const customThemes = () =>
    theme.themes().filter((t) => !BUILTIN_IDS.has(t.id));

  return (
    <Show when={props.open}>
      <div
        class="settings-dialog__overlay"
        onClick={() => props.onClose()}
        role="presentation"
      >
        <div
          class="settings-dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="settings-dialog__header">
            <h2 class="settings-dialog__title">Settings</h2>
            <button
              type="button"
              class="btn btn--small settings-dialog__close"
              aria-label="Close settings"
              onClick={() => props.onClose()}
            >
              ×
            </button>
          </div>

          <div class="settings-dialog__body">
            {/* ----------------------------------------------------------------
                Section 1: Theme picker
            ---------------------------------------------------------------- */}
            <section class="settings-dialog__section">
              <h3 class="settings-dialog__section-title">Theme</h3>
              <div class="settings-dialog__theme-grid">
                <For each={theme.themes()}>
                  {(t) => {
                    const scheme = theme.effectiveScheme();
                    const tokens = t.modes[scheme] ?? {};
                    const isActive = () => theme.activeTheme().id === t.id;
                    return (
                      <button
                        type="button"
                        class={`settings-dialog__theme-card${isActive() ? " is-active" : ""}`}
                        title={t.name}
                        onClick={() => theme.setTheme(t.id)}
                        onMouseEnter={() => theme.previewTheme(t.id)}
                        onMouseLeave={() => theme.previewTheme(null)}
                        aria-pressed={isActive()}
                        aria-label={`Select theme ${t.name}`}
                      >
                        <div class="settings-dialog__swatches">
                          <For each={SWATCH_TOKENS}>
                            {(token) => (
                              <span
                                class="settings-dialog__swatch"
                                style={{
                                  background: tokens[token] ?? "transparent",
                                }}
                                aria-hidden="true"
                              />
                            )}
                          </For>
                        </div>
                        <span class="settings-dialog__theme-name">{t.name}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>

            {/* ----------------------------------------------------------------
                Section 2: Color scheme
            ---------------------------------------------------------------- */}
            <section class="settings-dialog__section">
              <h3 class="settings-dialog__section-title">Color scheme</h3>
              <div
                class="settings-dialog__segmented"
                role="group"
                aria-label="Color scheme"
              >
                <For each={SCHEME_OPTIONS}>
                  {(opt) => (
                    <button
                      type="button"
                      class={`btn settings-dialog__segment${theme.preferences.colorScheme === opt.value ? " is-active" : ""}`}
                      aria-pressed={theme.preferences.colorScheme === opt.value}
                      onClick={() => theme.setColorScheme(opt.value)}
                    >
                      {opt.label}
                    </button>
                  )}
                </For>
              </div>
            </section>

            {/* ----------------------------------------------------------------
                Section 3: UI font
            ---------------------------------------------------------------- */}
            <section class="settings-dialog__section">
              <h3 class="settings-dialog__section-title">UI font</h3>
              <div class="settings-dialog__font-row">
                <select
                  class="settings-dialog__select"
                  aria-label="UI font family"
                  value={theme.preferences.uiFont.family}
                  onChange={(e) =>
                    theme.setUiFont({ family: e.currentTarget.value })
                  }
                >
                  <For each={UI_FONTS}>
                    {(f) => <option value={f.value}>{f.label}</option>}
                  </For>
                </select>
                <div class="settings-dialog__size-control">
                  <label class="settings-dialog__size-label">Size</label>
                  <input
                    type="number"
                    class="settings-dialog__size-input"
                    aria-label="UI font size"
                    min="10"
                    max="24"
                    value={theme.preferences.uiFont.sizePx}
                    onChange={(e) => {
                      const v = Math.max(
                        10,
                        Math.min(24, Number(e.currentTarget.value)),
                      );
                      theme.setUiFont({ sizePx: v });
                    }}
                  />
                  <span class="settings-dialog__size-unit">px</span>
                </div>
              </div>
            </section>

            {/* ----------------------------------------------------------------
                Section 4: Mono font
            ---------------------------------------------------------------- */}
            <section class="settings-dialog__section">
              <h3 class="settings-dialog__section-title">Monospace font</h3>
              <div class="settings-dialog__font-row">
                <select
                  class="settings-dialog__select"
                  aria-label="Mono font family"
                  value={theme.preferences.monoFont.family}
                  onChange={(e) =>
                    theme.setMonoFont({ family: e.currentTarget.value })
                  }
                >
                  <For each={MONO_FONTS}>
                    {(f) => <option value={f.value}>{f.label}</option>}
                  </For>
                </select>
                <div class="settings-dialog__size-control">
                  <label class="settings-dialog__size-label">Size</label>
                  <input
                    type="number"
                    class="settings-dialog__size-input"
                    aria-label="Mono font size"
                    min="10"
                    max="24"
                    value={theme.preferences.monoFont.sizePx}
                    onChange={(e) => {
                      const v = Math.max(
                        10,
                        Math.min(24, Number(e.currentTarget.value)),
                      );
                      theme.setMonoFont({ sizePx: v });
                    }}
                  />
                  <span class="settings-dialog__size-unit">px</span>
                </div>
              </div>
            </section>

            {/* ----------------------------------------------------------------
                Section 5: Custom themes
            ---------------------------------------------------------------- */}
            <section class="settings-dialog__section">
              <h3 class="settings-dialog__section-title">Custom themes</h3>
              <div class="settings-dialog__custom-actions">
                <button
                  type="button"
                  class="btn"
                  onClick={() => void handleImport()}
                >
                  Import theme…
                </button>
              </div>
              <Show when={importError()}>
                {(err) => (
                  <div class="banner banner--error" role="alert">
                    {err()}
                  </div>
                )}
              </Show>
              <Show
                when={customThemes().length > 0}
                fallback={
                  <p class="empty settings-dialog__empty">
                    No custom themes installed.
                  </p>
                }
              >
                <ul class="settings-dialog__custom-list">
                  <For each={customThemes()}>
                    {(t) => (
                      <li class="settings-dialog__custom-item">
                        <span class="settings-dialog__custom-name">
                          {t.name}
                        </span>
                        <button
                          type="button"
                          class="btn btn--tiny"
                          aria-label={`Remove theme ${t.name}`}
                          onClick={() => void theme.removeCustomTheme(t.id)}
                        >
                          Remove
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </div>
        </div>
      </div>
    </Show>
  );
}
