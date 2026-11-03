/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Montserrat', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Apple System Blue accent.
        accent: '#0071E3',
        'accent-hover': '#0077ED',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(31, 38, 135, 0.12)',
        'glass-lg': '0 12px 48px rgba(31, 38, 135, 0.18)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'shimmer': 'shimmer 1.8s linear infinite',
      },
    },
  },
  plugins: [],
}