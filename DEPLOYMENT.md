# smartTradeUST - Deployment Guide

## Production Setup with Cloudflare Tunnel

Your application is configured to run at: **https://smart-trade.ustsea.com/**

---

## Architecture

```
Internet
   ↓
Cloudflare Tunnel (smart-trade.ustsea.com)
   ↓
   ├── /api/*  → localhost:5294 (FastAPI Backend)
   └── /*      → localhost:4100 (Angular Frontend)
```

---

## Prerequisites

1. **Cloudflared installed** on your server
2. **Docker & Docker Compose** installed
3. **Domain** configured in Cloudflare DNS

---

## Step-by-Step Deployment

### 1. Start the Application

```bash
cd /home/sshuser/gitapp/smartTradeUST
docker compose up -d
```

**Verify services are running:**
```bash
docker ps
# Should show:
# - smarttrade-api (port 5294)
# - smarttrade-ui (port 4100)
```

---

### 2. Configure Cloudflare Tunnel

**A. Install cloudflared (if not already):**
```bash
# Download latest
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

**B. Login to Cloudflare:**
```bash
cloudflared tunnel login
```
This opens a browser - select your domain (ustsea.com).

**C. Create the tunnel:**
```bash
cloudflared tunnel create smart-trade
```
Note the **Tunnel ID** displayed.

**D. Update the config file:**
```bash
# Edit cloudflared-config.yml
nano cloudflared-config.yml

# Replace YOUR-TUNNEL-ID with the ID from step C
# Replace the credentials-file path with your actual path
```

**E. Route DNS:**
```bash
cloudflared tunnel route dns smart-trade smart-trade.ustsea.com
```

**F. Test the tunnel:**
```bash
cloudflared tunnel --config cloudflared-config.yml run
```

---

### 3. Run Tunnel as Service (Production)

**Create systemd service:**
```bash
sudo nano /etc/systemd/system/cloudflared-smart-trade.service
```

**Service file content:**
```ini
[Unit]
Description=Cloudflare Tunnel for smartTradeUST
After=network.target

[Service]
Type=simple
User=sshuser
ExecStart=/usr/local/bin/cloudflared tunnel --config /home/sshuser/gitapp/smartTradeUST/cloudflared-config.yml run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-smart-trade
sudo systemctl start cloudflared-smart-trade
sudo systemctl status cloudflared-smart-trade
```

---

## Verification

### Check Services
```bash
# Docker containers
docker ps

# Cloudflare tunnel
sudo systemctl status cloudflared-smart-trade

# Test API locally
curl http://localhost:5294/api/docs

# Test UI locally
curl http://localhost:4100
```

### Check Production URLs
```bash
# Should return 200 OK
curl -I https://smart-trade.ustsea.com/

# Should return Swagger UI HTML
curl https://smart-trade.ustsea.com/api/docs
```

---

## API Endpoints (Production)

Base URL: `https://smart-trade.ustsea.com/api`

| Endpoint | Description |
|----------|-------------|
| `/api/docs` | Swagger API Documentation |
| `/api/simulate/alerts` | Generate synthetic alerts |
| `/api/simulate/alerts/calibrate` | Pump & Dump calibration |
| `/api/pumpdumpml/detect` | ML detection engine |
| `/api/insidertrading/refine` | Insider trading refinement |
| `/api/reports/template` | Generate reports |

---

## Frontend Service Migration

Services need to be updated to use `ApiConfig`. Example:

**Before:**
```typescript
private baseUrl = 'http://localhost:5294/simulate/alerts/latest/insidertrading';
```

**After:**
```typescript
import { ApiConfig } from '../config/api.config';

private baseUrl = ApiConfig.SIMULATE_LATEST_INSIDER;
```

**Files to update:**
- ✅ `insider-trading.service.ts` (DONE)
- ⏳ `insider-trading-refine.service.ts`
- ⏳ `pump-and-dump.component.ts`
- ⏳ `pump-and-dump-ml.component.ts`
- ⏳ `ml-driven-calibration.component.ts`
- ⏳ `rule-grid.component.ts`
- ⏳ `final-verification.component.ts`

---

## Monitoring

### View Logs
```bash
# API logs
docker logs -f smarttrade-api

# UI logs
docker logs -f smarttrade-ui

# Tunnel logs
sudo journalctl -u cloudflared-smart-trade -f
```

### Metrics
Cloudflare tunnel metrics: `http://localhost:8099/metrics`

---

## Troubleshooting

### CORS Errors
Check `pythonAPI/app/main.py` - ensure your domain is in `allow_origins`.

### API 404 Errors
Verify `root_path="/api"` is set in FastAPI app configuration.

### Tunnel Not Connecting
```bash
# Check tunnel status
cloudflared tunnel info smart-trade

# Check DNS
dig smart-trade.ustsea.com

# Test local services
curl http://localhost:5294/api/docs
curl http://localhost:4100
```

### Mixed Content Errors
Ensure API is served via tunnel (HTTPS), not direct HTTP.

---

## Updating the Application

```bash
# Pull latest code
cd /home/sshuser/gitapp/smartTradeUST
git pull

# Rebuild and restart
docker compose down
docker compose up --build -d

# Tunnel auto-restarts via systemd
```

---

## Security Checklist

- [x] CORS restricted to specific domains
- [x] HTTPS enforced via Cloudflare
- [ ] Add authentication/authorization
- [ ] Add rate limiting
- [ ] Configure firewall rules
- [ ] Set up monitoring/alerts
- [ ] Regular backups of data directory

---

## Support

For issues, check:
1. Docker logs
2. Cloudflare tunnel logs
3. Browser console (F12)
4. Network tab for failed requests

---

**Current Status:**
- ✅ API configured with `/api` root path
- ✅ CORS configured for production domain
- ✅ Environment configs created
- ✅ Example service migrated
- ✅ Cloudflare tunnel config ready
- ⏳ Remaining services need migration
