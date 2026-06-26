import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18202f",
        paper: "#f7f8fb",
        line: "#d9dee8",
        brand: {
          50: "#eff6ff",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        success: "#138a52",
        warning: "#b7791f",
        danger: "#b42318",
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(24, 32, 47, 0.08)",
      },
    },
  },
  plugins: [
    ({ addUtilities }) => {
      addUtilities({
        ".v-stack": { display: "flex", flexDirection: "column" },
        ".h-stack": { display: "flex", flexDirection: "row" },
        ".center": { display: "flex", alignItems: "center", justifyContent: "center" },
        ".spacer": { flex: "1 1 auto" },
        ".circle": { aspectRatio: "1 / 1", borderRadius: "9999px" },
      });
    },
  ],
};

export default config;
