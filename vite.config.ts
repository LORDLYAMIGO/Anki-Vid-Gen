import {defineConfig} from 'vite';
export default defineConfig({root: 'studio', server: {port: 5173, proxy: {'/api': 'http://127.0.0.1:4174', '/media': 'http://127.0.0.1:4174'}}});
