import type { Theme } from "../types";
import openCherryDefault from "./opencherry-default.json";
import dracula from "./dracula.json";
import nord from "./nord.json";
import gruvbox from "./gruvbox.json";
import catppuccin from "./catppuccin.json";
import tokyoNight from "./tokyo-night.json";
import solarized from "./solarized.json";
import oneDark from "./one-dark.json";

export const BUILTIN_THEMES: Theme[] = [
  openCherryDefault as Theme,
  dracula as Theme,
  nord as Theme,
  gruvbox as Theme,
  catppuccin as Theme,
  tokyoNight as Theme,
  solarized as Theme,
  oneDark as Theme,
];

export const DEFAULT_THEME_ID = "opencherry-default";
