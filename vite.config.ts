import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://127.0.0.1:4174' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    modulePreload: {
      // Vite's __vitePreload wrapper walks the *entire* nested dynamic-import
      // graph reachable from each route (including doubly-lazy chunks like
      // HeroCanvas -> three, or a topic Sim -> rapier) and gates the outer
      // route chunk's own fetch behind loading ALL of them first. That means
      // every route (HomePage, SectionPage, TopicPage, even NotFoundPage) was
      // stuck waiting on the 343KB "three" chunk (and topic routes on the
      // 838KB "rapier" chunk) before their own tiny chunk could even start
      // downloading. Stripping these heavy, genuinely-optional chunks out of
      // the preload/gate list lets each route load immediately; the heavy
      // chunk still loads on its own once the component that actually needs
      // it (HeroCanvas, a specific topic's Sim) is reached.
      resolveDependencies: (_filename, deps) => deps.filter((dep) => !/\/(three|rapier)-/.test(dep)),
    },
    rollupOptions: {
      output: {
        // Function form (not the object form): @react-three/fiber statically
        // imports react-dom/client, and Rollup can't duplicate React's
        // singleton runtime across chunks. With the object form, Rollup ended
        // up physically co-locating React itself inside the "three" chunk
        // file (to serve as the shared facade for both "three"'s internal
        // needs and the rest of the app's), making the 340KB three.js bundle
        // an unavoidable eager dependency of every chunk, including the main
        // entry. Explicit id-based checks give Rollup no ambiguity about
        // where React's runtime belongs.
        manualChunks(id) {
          // Vite's own dynamic-import helper (used by every lazy() chunk in
          // the app) is a virtual module with no node_modules path, so it
          // isn't caught by the checks below — left alone, Rollup physically
          // parks it inside whichever chunk it processes first, which was
          // "three". Force it into vendor-react (already an eager, always-
          // loaded dependency) so it stops dragging three.js in as a
          // by-product.
          if (id === '\0vite/preload-helper.js') return 'vendor-react';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (/node_modules\/(three|@react-three\/(fiber|drei|postprocessing))\//.test(id)) return 'three';
          if (/node_modules\/@react-three\/rapier\//.test(id)) return 'rapier';
          if (/node_modules\/gsap\//.test(id)) return 'gsap';
          if (/node_modules\/(katex|react-katex)\//.test(id)) return 'katex';
        },
      },
    },
  },
})
