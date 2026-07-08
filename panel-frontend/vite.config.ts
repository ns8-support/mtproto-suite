import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'gravity-ui': ['@gravity-ui/uikit', '@gravity-ui/icons', '@gravity-ui/navigation'],
          'chart': ['chart.js', 'react-chartjs-2', 'chartjs-adapter-date-fns', 'chartjs-plugin-zoom'],
        },
      },
    },
  },
});
