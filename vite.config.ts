import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import Icons from 'unplugin-icons/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/stl-blueprint/' : '/',
  plugins: [
    vue(),
    Icons({ compiler: 'vue3' }),
  ],
}))
