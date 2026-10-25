/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--reader-bg) / <alpha-value>)',
        fg: 'rgb(var(--reader-fg) / <alpha-value>)',
        accent: 'rgb(var(--reader-accent) / <alpha-value>)',
        panel: 'rgb(var(--reader-panel) / <alpha-value>)',
        muted: 'rgb(var(--reader-muted) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
