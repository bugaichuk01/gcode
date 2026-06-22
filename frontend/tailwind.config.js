export default {

  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],

  theme: {

    extend: {

      colors: {

        forest: {

          50: "#f5f7ff",

          100: "#e8ecff",

          200: "#d4dcff",

          300: "#b4c0ff",

          400: "#8b97f5",

          500: "#6366f1",

          600: "#4f46e5",

          700: "#4338ca",

          800: "#3730a3",

          900: "#312e81",

          950: "#1e1b4b",

        },

        sage: {

          50: "#f8fafc",

          100: "#f1f5f9",

          200: "#e2e8f0",

          300: "#cbd5e1",

          400: "#94a3b8",

          500: "#64748b",

          600: "#475569",

          700: "#334155",

          800: "#1e293b",

          900: "#0f172a",

        },

        mint: {

          50: "#f0fdfa",

          100: "#ccfbf1",

          200: "#99f6e4",

          300: "#5eead4",

          400: "#2dd4bf",

        },

        surface: "#ffffff",

        "surface-muted": "#f8fafc",

        "surface-subtle": "#f1f5f9",

      },

      fontFamily: {

        sans: [

          "Inter",

          "system-ui",

          "-apple-system",

          "Segoe UI",

          "Roboto",

          "Helvetica Neue",

          "Arial",

          "sans-serif",

        ],

      },

      borderRadius: {

        xl: "0.875rem",

        "2xl": "1rem",

        "3xl": "1.25rem",

      },

      boxShadow: {

        soft: "0 2px 8px -2px rgba(30, 27, 75, 0.08), 0 4px 16px -4px rgba(30, 27, 75, 0.06)",

        card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px -8px rgba(30, 27, 75, 0.1)",

        glow: "0 0 0 3px rgba(99, 102, 241, 0.18)",

        glass: "0 8px 32px rgba(30, 27, 75, 0.08)",

      },

      animation: {

        "fade-in": "fadeIn 0.3s ease-out",

        "slide-up": "slideUp 0.35s ease-out",

        "scale-in": "scaleIn 0.2s ease-out",

      },

      keyframes: {

        fadeIn: {

          "0%": { opacity: "0" },

          "100%": { opacity: "1" },

        },

        slideUp: {

          "0%": { opacity: "0", transform: "translateY(8px)" },

          "100%": { opacity: "1", transform: "translateY(0)" },

        },

        scaleIn: {

          "0%": { opacity: "0", transform: "scale(0.96)" },

          "100%": { opacity: "1", transform: "scale(1)" },

        },

      },

    },

  },

  plugins: [],

};
