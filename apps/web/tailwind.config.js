/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        respawn: {
          base: "#0F1115",
          panel: "#1A1F29",
          neon: "#39FF88",
          purple: "#8B5CF6",
          ice: "#F3F6FB",
        },
      },
      boxShadow: {
        "neon-soft": "0 0 34px rgba(57, 255, 136, 0.16)",
        "purple-soft": "0 0 44px rgba(139, 92, 246, 0.14)",
        panel: "0 28px 80px rgba(0, 0, 0, 0.48)",
      },
      fontFamily: {
        display: ["Arial Black", "Arial", "sans-serif"],
        sans: ["Inter", "Segoe UI", "Arial", "sans-serif"],
      },
      letterSpacing: {
        digital: "0.18em",
      },
    },
  },
  plugins: [],
};
