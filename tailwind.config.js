/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './lib/escalations.js', // escalation badge colours live next to the level rules
  ],
  theme: {
    extend: {
      colors: {
        brembo: {
          red: '#c8102e',
          reddim: '#a50e26',
          ink: '#1c1418',
          paper: '#f4f2f0',
          panel: '#ffffff',
          panel2: '#f7f3f4',
          line: '#e4d9dc',
          sub: '#635c5f',
          green: '#2E9E5B',
          yellow: '#D9A31A',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'DM Sans', 'sans-serif'],
      },
      boxShadow: {
        card: '0 8px 24px rgba(28, 20, 24, 0.08)',
        defined: '0 1px 0 rgba(28, 20, 24, 0.04), 0 10px 28px rgba(28, 20, 24, 0.08)',
      },
    },
  },
  plugins: [],
};
