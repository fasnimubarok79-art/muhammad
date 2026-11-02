import type { Config } from "tailwindcss";

// Mirrors DESIGN.md. Change DESIGN.md first, then these tokens.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F19",
        surface: "#121826",
        surface2: "#1A2232",
        line: "#263046",
        ink: "#E8ECF4",
        muted: "#9AA4B6",
        faint: "#5B6478",
        edit: "#FF7A1A",
        system: "#3DDC97",
        warn: "#FFC24D",
        danger: "#FF6B6B",
      },
      fontFamily: {
        display: ['"Archivo Variable"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
      },
      borderRadius: { ctl: "6px", card: "10px" },
      transitionTimingFunction: { out: "cubic-bezier(0.23, 1, 0.32, 1)" },
      boxShadow: { float: "0 12px 32px rgb(0 0 0 / .45)" },
    },
  },
  plugins: [],
};
export default config;
