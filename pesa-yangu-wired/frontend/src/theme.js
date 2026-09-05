/**
 * theme.js � Design token sets for dark and light mode
 * Used across App.jsx and AuthPage.jsx
 */

export const DARK = {
  navy:        "#0A1712",
  navyMid:     "#102A1F",
  navyLight:   "#1C3A2C",
  teal:        "#00D4AA",
  gold:        "#F5C842",
  coral:       "#FF6B6B",
  blue:        "#4A90E2",
  purple:      "#9B59B6",
  green:       "#2ECC71",
  orange:      "#E67E22",
  textPrimary: "#F0F4FF",
  textMuted:   "#8FAE9C",
  textFaint:   "#3D5F4E",
  // extras for light-mode-aware borders / shadows
  shadow:      "rgba(0,0,0,0.4)",
  inputBorder: "#1C3A2C",
};

export const LIGHT = {
  navy:        "#F0F4FF",
  navyMid:     "#FFFFFF",
  navyLight:   "#E8EDF8",
  teal:        "#00A87F",
  gold:        "#C49A00",
  coral:       "#D94F4F",
  blue:        "#2B6CB0",
  purple:      "#6B3FA0",
  green:       "#1E8A4C",
  orange:      "#B05B00",
  textPrimary: "#0D1B2A",
  textMuted:   "#4A5568",
  textFaint:   "#A0AEC0",
  shadow:      "rgba(0,0,0,0.12)",
  inputBorder: "#CBD5E0",
};

export const getTheme = () =>
  localStorage.getItem("py_theme") === "light" ? "light" : "dark";

export const setTheme = (t) =>
  localStorage.setItem("py_theme", t);

export const tokens = (theme) =>
  theme === "light" ? LIGHT : DARK;
