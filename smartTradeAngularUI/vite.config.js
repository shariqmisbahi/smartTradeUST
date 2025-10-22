// smartTradeAngularUI/vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        host: '0.0.0.0',  // Listen on all interfaces
        port: 4100,
        strictPort: true,
        allowedHosts: ['.ustsea.com', 'localhost', '127.0.0.1'],
        hmr: {
            // Hot Module Replacement for Cloudflare tunnel
            // Uses wss (secure websocket) when accessed via HTTPS
            clientPort: 443,
            protocol: 'wss',
            host: 'smart-trade.ustsea.com'
        }
    },
    preview: {
        allowedHosts: true
    },
})
