import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` is set from the repository name by the deploy workflow, so the same
// config serves both `npm run dev` at / and GitHub Pages at /<repo>/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
