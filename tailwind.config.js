/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.ejs",
    "./src/js/**/*.js",
    "./public/js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          yellow: 'var(--yellow)',
          teal: 'var(--teal)',
          'teal-dark': 'var(--teal-dark)',
          orange: 'var(--orange)',
          'light-grey': 'var(--light-grey)',
          'dark-grey': 'var(--dark-grey)',
          white: 'var(--white)',
        }
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      transitionProperty: {
        custom: 'var(--transition)',
      }
    },
  },
  plugins: [],
}
