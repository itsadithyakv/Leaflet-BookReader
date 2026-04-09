/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#131313",
        surface: "#131313",
        "surface-dim": "#131313",
        "surface-bright": "#393939",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-low": "#1c1b1b",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "surface-container-highest": "#353534",
        "surface-variant": "#353534",
        "surface-tint": "#65a83f",
        primary: "#65a83f",
        "primary-container": "#4F8833",
        "primary-fixed": "#D6E8C6",
        "primary-fixed-dim": "#B7D39D",
        "on-primary": "#10210B",
        "on-primary-container": "#EEF6E6",
        "on-primary-fixed": "#10210B",
        "on-primary-fixed-variant": "#4F8833",
        secondary: "#6FC28E",
        "secondary-container": "#295B3E",
        "secondary-fixed": "#CFEBD8",
        "secondary-fixed-dim": "#9ED0B2",
        "on-secondary": "#0B2A18",
        "on-secondary-container": "#E5F3EB",
        "on-secondary-fixed": "#0B2A18",
        "on-secondary-fixed-variant": "#295B3E",
        tertiary: "#5BBE7B",
        "tertiary-container": "#2B5F43",
        "tertiary-fixed": "#CFEBD8",
        "tertiary-fixed-dim": "#9ED0B2",
        "on-tertiary": "#0B2A18",
        "on-tertiary-container": "#E5F3EB",
        "on-tertiary-fixed": "#0B2A18",
        "on-tertiary-fixed-variant": "#2B5F43",
        error: "#ffb4ab",
        "error-container": "#93000a",
        "on-error": "#690005",
        "on-error-container": "#ffdad6",
        outline: "#9a8c9b",
        "outline-variant": "#4e4350",
        "on-surface": "#e5e2e1",
        "on-surface-variant": "#d1c2d2",
        "on-background": "#e5e2e1",
        "inverse-surface": "#e5e2e1",
        "inverse-on-surface": "#313030",
        "inverse-primary": "#4F8833",
        graphite: {
          900: "#0b0c10",
          850: "#11131a",
          800: "#141720",
          750: "#1d2029",
          700: "#252934",
          600: "#343848",
          500: "#4c5164"
        }
      },
      boxShadow: {
        glow: "0 20px 50px rgba(0, 0, 0, 0.45)",
        accent: "0 0 35px rgba(255, 97, 199, 0.3)"
      },
      backgroundImage: {
        accent:
          "linear-gradient(135deg, #ff61c7 0%, #b55bff 35%, #4c7bff 70%, #39d6ff 100%)"
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        label: ["Inter", "sans-serif"]
      }
    }
  },
  plugins: []
};
