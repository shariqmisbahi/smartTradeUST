// smartTradeAngularUI/vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        host: true,
        port: 4100,
        strictPort: true,
        allowedHosts: ['smart-trade.ustsea.com']
        // hmr: { host: 'smart-trade.ustsea.com', protocol: 'wss', port: 443 } // if behind HTTPS proxy
    },
    preview: { allowedHosts: true },
})
