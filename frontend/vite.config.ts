import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: ['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx']
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
});
