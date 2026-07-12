/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './landing.html',
    './admin.html',
    './app.js',
    './ui-dialogs.js',
    './export-tools.js',
    './record-card.js',
    './ai-chat.js',
    './year-report-image.js',
    './tests/*.html',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          light: 'var(--brand-light)',
          border: 'var(--brand-border)',
        },
        apple: {
          dark: '#1c1c1e',
          darker: '#000000',
          light: '#f2f2f7',
        },
      },
      boxShadow: {
        soft: '0 8px 32px -8px rgba(0,0,0,.08)',
        premium: '0 20px 60px -15px rgba(0,0,0,.12)',
      },
    },
  },
  plugins: [],
};
