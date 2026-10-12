import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import AutoImport from 'unplugin-auto-import/vite';
import {
  ElementPlusResolver,
} from 'unplugin-vue-components/resolvers'
// vite.config.js
import Components from 'unplugin-vue-components/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-v20.js',
        chunkFileNames: 'assets/[name]-[hash]-v20.js',
        assetFileNames: 'assets/[name]-[hash]-v20.[ext]',
      },
    },
  },
  plugins: [
    vue(),
    Icons({
      compiler: 'vue3',
    }),
    AutoImport({
      eslintrc: {
        enabled: true,
      },
      imports: ["vue", "vue-router"],
    }),
    Components({
      resolvers: [
        IconsResolver({
          enabledCollections: ['ep'],
        }),
        ElementPlusResolver(),
      ],
    }),
  ],
})
