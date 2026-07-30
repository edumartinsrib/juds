import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        surface: token("surface"),
        "surface-raised": token("surface-raised"),
        foreground: token("foreground"),
        muted: token("muted"),
        "muted-surface": token("muted-surface"),
        line: token("line"),
        brand: token("brand"),
        "brand-strong": token("brand-strong"),
        "brand-soft": token("brand-soft"),
        success: token("success"),
        "success-soft": token("success-soft"),
        warning: token("warning"),
        "warning-soft": token("warning-soft"),
        danger: token("danger"),
        "danger-soft": token("danger-soft"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        subtle: "0 1px 2px hsl(var(--shadow) / 0.08)",
        dialog:
          "0 28px 80px -28px hsl(var(--shadow) / 0.48), 0 8px 24px -12px hsl(var(--shadow) / 0.22)",
      },
    },
  },
  plugins: [
    ({ addUtilities }) => {
      addUtilities({
        ".v-stack": { display: "flex", flexDirection: "column" },
        ".h-stack": { display: "flex", flexDirection: "row" },
        ".v-stack-reverse": { display: "flex", flexDirection: "column-reverse" },
        ".h-stack-reverse": { display: "flex", flexDirection: "row-reverse" },
        ".z-stack": {
          display: "grid",
          alignItems: "center",
          justifyItems: "center",
        },
        ".center": { display: "flex", alignItems: "center", justifyContent: "center" },
        ".spacer": { flex: "1 1 auto" },
        ".circle": {
          aspectRatio: "1 / 1",
          borderRadius: "9999px",
          flexShrink: "0",
        },
      });
    },
  ],
};

export default config;
