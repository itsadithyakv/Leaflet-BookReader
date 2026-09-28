/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        // A landscape phone is *wider* than `md` (844x390 on an iPhone 14), so
        // width alone misreads it as a tablet. Height is the real constraint
        // there, and these two carry that distinction into the markup.
        short: { raw: "(max-height: 520px)" },
        tall: { raw: "(min-height: 521px)" },
        // Touch input, regardless of screen size: hover affordances do not
        // exist and hit targets need to be finger-sized.
        touch: { raw: "(hover: none) and (pointer: coarse)" }
      },
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-dim": "rgb(var(--color-surface-dim) / <alpha-value>)",
        "surface-bright": "rgb(var(--color-surface-bright) / <alpha-value>)",
        "surface-container-lowest": "rgb(var(--color-surface-lowest) / <alpha-value>)",
        "surface-container-low": "rgb(var(--color-surface-low) / <alpha-value>)",
        "surface-container": "rgb(var(--color-surface-container) / <alpha-value>)",
        "surface-container-high": "rgb(var(--color-surface-high) / <alpha-value>)",
        "surface-container-highest": "rgb(var(--color-surface-highest) / <alpha-value>)",
        "surface-variant": "rgb(var(--color-surface-highest) / <alpha-value>)",
        "surface-tint": "rgb(var(--color-primary) / <alpha-value>)",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        "primary-container": "rgb(var(--color-primary-container) / <alpha-value>)",
        "primary-fixed": "rgb(var(--color-primary-fixed) / <alpha-value>)",
        "primary-fixed-dim": "rgb(var(--color-primary-fixed-dim) / <alpha-value>)",
        "on-primary": "rgb(var(--color-on-primary) / <alpha-value>)",
        "on-primary-container": "rgb(var(--color-on-primary-container) / <alpha-value>)",
        "on-primary-fixed": "rgb(var(--color-on-primary) / <alpha-value>)",
        "on-primary-fixed-variant": "rgb(var(--color-primary-container) / <alpha-value>)",
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        "secondary-container": "rgb(var(--color-secondary-container) / <alpha-value>)",
        "secondary-fixed": "rgb(var(--color-secondary-fixed) / <alpha-value>)",
        "secondary-fixed-dim": "rgb(var(--color-secondary-fixed-dim) / <alpha-value>)",
        "on-secondary": "rgb(var(--color-on-secondary) / <alpha-value>)",
        "on-secondary-container": "rgb(var(--color-on-secondary-container) / <alpha-value>)",
        "on-secondary-fixed": "rgb(var(--color-on-secondary) / <alpha-value>)",
        "on-secondary-fixed-variant": "rgb(var(--color-secondary-container) / <alpha-value>)",
        tertiary: "rgb(var(--color-tertiary) / <alpha-value>)",
        "tertiary-container": "rgb(var(--color-tertiary-container) / <alpha-value>)",
        "tertiary-fixed": "rgb(var(--color-secondary-fixed) / <alpha-value>)",
        "tertiary-fixed-dim": "rgb(var(--color-secondary-fixed-dim) / <alpha-value>)",
        "on-tertiary": "rgb(var(--color-on-secondary) / <alpha-value>)",
        "on-tertiary-container": "rgb(var(--color-on-secondary-container) / <alpha-value>)",
        "on-tertiary-fixed": "rgb(var(--color-on-secondary) / <alpha-value>)",
        "on-tertiary-fixed-variant": "rgb(var(--color-secondary-container) / <alpha-value>)",
        error: "rgb(var(--color-error) / <alpha-value>)",
        "error-container": "rgb(var(--color-error-container) / <alpha-value>)",
        "on-error": "rgb(var(--color-on-error) / <alpha-value>)",
        "on-error-container": "rgb(var(--color-on-error-container) / <alpha-value>)",
        outline: "rgb(var(--color-outline) / <alpha-value>)",
        "outline-variant": "rgb(var(--color-outline-variant) / <alpha-value>)",
        "on-surface": "rgb(var(--color-on-surface) / <alpha-value>)",
        "on-surface-variant": "rgb(var(--color-on-surface-variant) / <alpha-value>)",
        "on-background": "rgb(var(--color-on-surface) / <alpha-value>)",
        "inverse-surface": "rgb(var(--color-on-surface) / <alpha-value>)",
        "inverse-on-surface": "rgb(var(--color-surface) / <alpha-value>)",
        "inverse-primary": "rgb(var(--color-primary) / <alpha-value>)",
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
        accent: "0 0 24px rgba(67, 225, 132, 0.2)"
      },
      backgroundImage: {
        accent:
          "linear-gradient(135deg, #087b45 0%, #0f9d59 50%, #43e184 100%)"
      },
      fontFamily: {
        display: ["ZT Nature", "Segoe UI", "system-ui", "sans-serif"],
        headline: ["ZT Nature", "Segoe UI", "system-ui", "sans-serif"],
        body: ["ZT Nature", "Segoe UI", "system-ui", "sans-serif"],
        label: ["ZT Nature", "Segoe UI", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
