/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // <html class="dark"> の有無で切り替える（OS 設定に追従する 'system' も同じ仕組みで扱う）
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        logo: ['Fredoka', 'ui-rounded', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
      },
    },
  },
  plugins: [],
};
