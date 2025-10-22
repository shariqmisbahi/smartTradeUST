# Service Migration Checklist

## Services to Update

Replace hardcoded `localhost:5294` URLs with `ApiConfig` imports.

### ✅ Completed
- [x] `insider-trading.service.ts` - Uses `ApiConfig.SIMULATE_LATEST_INSIDER`

### ⏳ Pending Migration

#### 1. insider-trading-refine.service.ts
**Location:** `smartTradeAngularUI/src/app/services/`
**Update:** Import `ApiConfig` and use `ApiConfig.INSIDER_REFINE`

#### 2. pump-and-dump.component.ts
**Location:** `smartTradeAngularUI/src/app/pump-and-dump/`
**Lines to update:**
- Line ~698: Export URL
- Add import: `import { ApiConfig } from '../config/api.config';`

#### 3. pump-and-dump-ml.component.ts
**Location:** `smartTradeAngularUI/src/app/pump-and-dump-ml/`
**Update:** Line with `/simulate/alerts/calibrate`
- Use: `ApiConfig.PUMPDUMP_CALIBRATE`

#### 4. ml-driven-calibration.component.ts
**Location:** `smartTradeAngularUI/src/app/ml-driven-calibration/`
**Update:** Line with `/pumpdumpml/detect`
- Use: `ApiConfig.PUMPDUMP_ML_DETECT`

#### 5. rule-grid.component.ts
**Location:** `smartTradeAngularUI/src/app/rule-grid/`
**Update:** Line with `/simulate/alerts/latest/pumpdump`
- Use: `ApiConfig.SIMULATE_LATEST_PUMPDUMP`

#### 6. final-verification.component.ts
**Location:** `smartTradeAngularUI/src/app/final-verification/`
**Lines to update:**
- Line ~57: `/reports/template`
- Use: `ApiConfig.REPORTS_TEMPLATE`

#### 7. param-wizard-dialog.component.ts
**Location:** `smartTradeAngularUI/src/app/pump-and-dump/param-wizard-dialog/`
**Update:** Verify/export endpoints

---

## Migration Pattern

**Before:**
```typescript
export class MyService {
  private apiUrl = 'http://localhost:5294/some/endpoint';

  getData() {
    return this.http.get(this.apiUrl);
  }
}
```

**After:**
```typescript
import { ApiConfig } from '../config/api.config';

export class MyService {
  private apiUrl = ApiConfig.SOME_ENDPOINT;  // Use constant

  getData() {
    return this.http.get(this.apiUrl);
  }
}
```

---

## Adding New Endpoints to ApiConfig

If you need an endpoint not in `api.config.ts`:

```typescript
// In api.config.ts, add:
static readonly YOUR_ENDPOINT = `${this.BASE_URL}/your/path`;

// Then use it:
import { ApiConfig } from '../config/api.config';
private apiUrl = ApiConfig.YOUR_ENDPOINT;
```

---

## Testing After Migration

1. **Local Development:**
   ```bash
   # Should use http://localhost:5294
   npm run start
   ```

2. **Production:**
   ```bash
   # Should use /api (relative path -> https://smart-trade.ustsea.com/api)
   npm run build
   ```

3. **Verify in Browser Console:**
   - Check Network tab
   - API calls should go to correct endpoint based on environment
   - No CORS errors

---

## Quick Find Command

Find all hardcoded localhost URLs:
```bash
cd smartTradeAngularUI/src
grep -r "localhost:5294" --include="*.ts" .
```

---

## Priority Order

1. **High Priority** (User-facing features):
   - insider-trading-refine.service.ts
   - pump-and-dump-ml.component.ts
   - ml-driven-calibration.component.ts

2. **Medium Priority**:
   - rule-grid.component.ts
   - final-verification.component.ts

3. **Low Priority** (Less used):
   - param-wizard-dialog.component.ts

---

## Benefits After Migration

✅ Environment-aware (auto-switches dev/prod)
✅ Single source of truth for API URLs
✅ Easy to update endpoints globally
✅ Works with Cloudflare tunnel
✅ Type-safe (TypeScript)
✅ No hardcoded paths
