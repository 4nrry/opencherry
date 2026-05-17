import type { FontPref, TokenMap } from "./types";
import {
  FONT_TOKEN_MONO,
  FONT_TOKEN_MONO_SIZE,
  FONT_TOKEN_UI,
  FONT_TOKEN_UI_SIZE,
} from "./tokens";

export function applyTokens(tokens: TokenMap): void {
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, value);
  }
}

export function applyFonts(uiFont: FontPref, monoFont: FontPref): void {
  document.documentElement.style.setProperty(FONT_TOKEN_UI, uiFont.family);
  document.documentElement.style.setProperty(
    FONT_TOKEN_UI_SIZE,
    `${uiFont.sizePx}px`,
  );
  document.documentElement.style.setProperty(FONT_TOKEN_MONO, monoFont.family);
  document.documentElement.style.setProperty(
    FONT_TOKEN_MONO_SIZE,
    `${monoFont.sizePx}px`,
  );
}
