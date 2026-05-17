import type { Theme } from "./types";
import { COLOR_TOKENS } from "./tokens";

export function validateTheme(
  theme: Theme,
  fallback: Theme,
): { theme: Theme; warnings: string[] } {
  const warnings: string[] = [];

  if (typeof theme.id !== "string" || theme.id.trim() === "") {
    warnings.push("Theme id is missing or empty.");
  }
  if (typeof theme.name !== "string" || theme.name.trim() === "") {
    warnings.push("Theme name is missing or empty.");
  }

  const modes = ["light", "dark"] as const;
  const completedModes = { light: { ...theme.modes.light }, dark: { ...theme.modes.dark } };

  for (const mode of modes) {
    for (const token of COLOR_TOKENS) {
      if (!(token in completedModes[mode])) {
        const fallbackValue = fallback.modes[mode][token];
        if (fallbackValue !== undefined) {
          completedModes[mode][token] = fallbackValue;
          warnings.push(
            `Theme "${theme.id}" is missing token "${token}" in "${mode}" mode; filled from fallback.`,
          );
        } else {
          warnings.push(
            `Theme "${theme.id}" is missing token "${token}" in "${mode}" mode; and the fallback has no value either.`,
          );
        }
      }
    }
  }

  const completedTheme: Theme = {
    id: theme.id,
    name: theme.name,
    modes: completedModes,
  };

  return { theme: completedTheme, warnings };
}
