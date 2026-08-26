import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/stl-blueprint/' : '/',
  plugins: [vue()],
}))
