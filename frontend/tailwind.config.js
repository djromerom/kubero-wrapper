/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: { colors: { atlas: { ink: '#1D1D1B', red: '#A00000', accent: '#FF3010', mist: '#EBEBEB', paper: '#FFFFFF', muted: '#62625E' } }, fontFamily: { sans: ['"Segoe UI"', 'Arial', 'sans-serif'] } },
  },
  plugins: [],
};
