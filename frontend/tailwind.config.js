/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        prestisa: {
          DEFAULT: '#7B1FA2',
          50:  '#F5E6FA',
          100: '#E8C7F2',
          200: '#D49AE6',
          300: '#BC6BD8',
          400: '#9F47C8',
          500: '#7B1FA2',
          600: '#651688',
          700: '#4F116B',
          800: '#3B0C50',
          900: '#270835',
        },
        accent: { DEFAULT: '#E91E63' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 2px 8px -2px rgba(123,31,162,0.10), 0 4px 24px -8px rgba(123,31,162,0.08)',
      },
    },
  },
  plugins: [],
};
