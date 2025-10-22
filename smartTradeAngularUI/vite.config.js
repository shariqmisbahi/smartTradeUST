import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true,
        port: 4100,
        strictPort: true,
        allowedHosts: ['smart-trade.ustsea.com'], // or true while testing
        // hmr: { host: 'smart-trade.ustsea.com', protocol: 'wss', port: 443 }
    },
    preview: { allowedHosts: ['smart-trade.ustsea.com'] },
});
