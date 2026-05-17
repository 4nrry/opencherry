export type ColorScheme = "light" | "dark" | "system";
export type TokenMap = Record<string, string>;
export interface Theme {
  id: string;
  name: string;
  modes: { light: TokenMap; dark: TokenMap };
}
export interface FontPref {
  family: string;
  sizePx: number;
}
export interface Preferences {
  themeId: string;
  colorScheme: ColorScheme;
  uiFont: FontPref;
  monoFont: FontPref;
}
