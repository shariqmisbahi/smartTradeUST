// Simple production server for Angular static files
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4100;
const distPath = path.join(__dirname, 'dist/tradeUST/browser');

// Serve static files from the dist directory
app.use(express.static(distPath, {
    maxAge: '1y',
    etag: false
}));

// Handle Angular routing - return index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Production server running on http://0.0.0.0:${PORT}`);
    console.log(`📁 Serving files from: ${distPath}`);
});
