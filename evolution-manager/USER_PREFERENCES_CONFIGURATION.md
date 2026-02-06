# User Preferences Configuration Guide

This guide documents how to configure **user preferences** features in the Evolution Manager. These features allow the QD search loop to incorporate user feedback by:

1. **Parent Genome Selection** - Selecting parent genomes from sounds liked by users
2. **Elite Evaluation Augmentation** - Boosting scores based on similarity to user preferences

## Configuration Hierarchy

The Evolution Manager uses a **three-tier configuration hierarchy** where each level can override the previous:

```
┌─────────────────────────────────────────────────────────────┐
│                    Configuration Hierarchy                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. GLOBAL DEFAULTS (applies to ALL runs)                   │
│     ├── Environment Variables (GLOBAL_USER_PREFERENCES_*)   │
│     └── working/global-defaults.json                        │
│                    ↓                                        │
│  2. TEMPLATE DEFAULTS (per template)                        │
│     └── templates/{name}/evolution-run-config.jsonc         │
│                    ↓                                        │
│  3. REQUEST-SPECIFIC (per API call)                         │
│     └── POST /api/runs { options: {...} }                   │
│                                                              │
│  Priority: Request > Template > Global                      │
└─────────────────────────────────────────────────────────────┘
```

**Key benefit:** Set global defaults once and they apply to ALL evolution runs, regardless of which template is used.

---

## Global Defaults (Primary Configuration Method)

### Option 1: Environment Variables

Set environment variables in your `.env` file or shell to configure user preferences globally:

```bash
# Parent Selection Configuration
GLOBAL_USER_PREFERENCES_RATE=0.15
GLOBAL_USER_PREFERENCES_SERVICE_URL=http://localhost:3060
GLOBAL_USER_PREFERENCES_STRATEGY=weighted
GLOBAL_USER_PREFERENCES_USER_LIMIT=20
GLOBAL_USER_PREFERENCES_CACHE_SIZE=500
GLOBAL_USER_PREFERENCES_CACHE_REFRESH=300

# Evaluation Configuration
GLOBAL_USER_PREFERENCE_EVAL_ENABLED=true
GLOBAL_USER_PREFERENCE_EVAL_WEIGHT=0.2
GLOBAL_USER_PREFERENCE_EVAL_MODE=additive
GLOBAL_USER_PREFERENCE_SIMILARITY_THRESHOLD=0.3
GLOBAL_USER_PREFERENCE_AGGREGATION=max
```

### Option 2: Global Defaults File

Create `working/global-defaults.json` with your settings:

```json
{
  "userPreferences": {
    "rate": 0.15,
    "serviceUrl": "http://localhost:3060",
    "strategy": "weighted",
    "userLimit": 20,
    "cacheSize": 500,
    "cacheRefreshInterval": 300,
    "evaluationEnabled": true,
    "evaluationWeight": 0.2,
    "evaluationMode": "additive",
    "similarityThreshold": 0.3,
    "aggregation": "max"
  }
}
```

### Priority Order

When both environment variables and the global defaults file are present:
1. Start with values from `working/global-defaults.json`
2. Override with any set environment variables

---

## Environment Variable Reference

| Environment Variable | Config Key | Type | Default | Description |
|---------------------|------------|------|---------|-------------|
| `GLOBAL_USER_PREFERENCES_RATE` | `userPreferencesRate` | number | 0 | Probability (0-1) of selecting parent from user-liked sounds |
| `GLOBAL_USER_PREFERENCES_SERVICE_URL` | `userPreferencesServiceUrl` | string | "http://localhost:3060" | kromosynth-recommend service URL |
| `GLOBAL_USER_PREFERENCES_STRATEGY` | `userPreferencesStrategy` | string | "weighted" | Selection strategy: "weighted" or "uniform" |
| `GLOBAL_USER_PREFERENCES_USER_LIMIT` | `userPreferencesUserLimit` | number | 20 | Max users to fetch preferences from |
| `GLOBAL_USER_PREFERENCES_CACHE_SIZE` | `userPreferencesCacheSize` | number | 500 | Max genomes to cache locally |
| `GLOBAL_USER_PREFERENCES_CACHE_REFRESH` | `userPreferencesCacheRefreshInterval` | number | 300 | Cache refresh interval (seconds) |
| `GLOBAL_USER_PREFERENCE_EVAL_ENABLED` | `userPreferenceEvaluationEnabled` | boolean | false | Enable evaluation score augmentation |
| `GLOBAL_USER_PREFERENCE_EVAL_WEIGHT` | `userPreferenceEvaluationWeight` | number | 0.2 | Weight of user preference in final score |
| `GLOBAL_USER_PREFERENCE_EVAL_MODE` | `userPreferenceEvaluationMode` | string | "additive" | Mode: "additive", "multiplicative", or "filter" |
| `GLOBAL_USER_PREFERENCE_SIMILARITY_THRESHOLD` | `userPreferenceSimilarityThreshold` | number | 0.3 | Minimum similarity for filter mode |
| `GLOBAL_USER_PREFERENCE_AGGREGATION` | `userPreferenceAggregation` | string | "max" | Aggregation: "max", "mean", or "weighted_mean" |

---

## API Endpoints for Global Defaults

### Get Current Global Defaults

```bash
GET /api/config/global-defaults
```

**Response:**
```json
{
  "userPreferencesRate": 0.15,
  "userPreferencesServiceUrl": "http://localhost:3060",
  "userPreferencesStrategy": "weighted",
  "userPreferencesUserLimit": 20,
  "userPreferencesCacheSize": 500,
  "userPreferencesCacheRefreshInterval": 300,
  "userPreferenceEvaluationEnabled": true,
  "userPreferenceEvaluationWeight": 0.2,
  "userPreferenceEvaluationMode": "additive",
  "userPreferenceSimilarityThreshold": 0.3,
  "userPreferenceAggregation": "max"
}
```

### Update Global Defaults

```bash
PUT /api/config/global-defaults
Content-Type: application/json

{
  "userPreferencesRate": 0.2,
  "userPreferenceEvaluationEnabled": true,
  "userPreferenceEvaluationWeight": 0.3
}
```

**Note:** This persists the settings to `working/global-defaults.json`. Changes take effect for all subsequent runs.

---

## Configuration Parameters

### Parent Selection Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userPreferencesRate` | number | 0 | Probability (0-1) of selecting a parent from user-liked genomes instead of the elite map |
| `userPreferencesServiceUrl` | string | "http://localhost:3060" | URL of the kromosynth-recommend service |
| `userPreferencesStrategy` | string | "weighted" | How to select among user preferences: <br>• `"weighted"` - Bias toward more active users<br>• `"uniform"` - Equal probability for all |
| `userPreferencesUserLimit` | number | 20 | Maximum number of users to fetch preferences from |
| `userPreferencesCacheSize` | number | 500 | Maximum genomes to keep in local cache |
| `userPreferencesCacheRefreshInterval` | number | 300 | How often to refresh the cache (seconds) |

### Evaluation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userPreferenceEvaluationEnabled` | boolean | false | Whether to augment elite scores with user preference similarity |
| `userPreferenceEvaluationWeight` | number | 0.2 | How much influence user preferences have on the final score (0-1) |
| `userPreferenceEvaluationMode` | string | "additive" | How to combine the preference score:<br>• `"additive"` - Add weighted preference score<br>• `"multiplicative"` - Multiply by (1 + weight × similarity)<br>• `"filter"` - Reject candidates below threshold |
| `userPreferenceSimilarityThreshold` | number | 0.3 | Minimum similarity required (only used in "filter" mode) |
| `userPreferenceAggregation` | string | "max" | How to combine similarity across multiple users:<br>• `"max"` - Use highest similarity<br>• `"mean"` - Use average similarity<br>• `"weighted_mean"` - Weight by user activity |

---

## Per-Run Overrides via API

Override global defaults for a specific run:

```bash
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "quality-musicality",
    "options": {
      "userPreferencesRate": 0.25,
      "userPreferenceEvaluationEnabled": true,
      "userPreferenceEvaluationWeight": 0.4
    }
  }'
```

These options override both global defaults and template defaults for this specific run only.

---

## Quick Start Examples

### Example 1: Enable User Preferences Globally

Add to your `.env` file:

```bash
# Enable parent selection from user-liked sounds (15% of the time)
GLOBAL_USER_PREFERENCES_RATE=0.15

# Enable evaluation boost based on user preferences
GLOBAL_USER_PREFERENCE_EVAL_ENABLED=true
GLOBAL_USER_PREFERENCE_EVAL_WEIGHT=0.2
```

### Example 2: Create Global Defaults File

```bash
cat > working/global-defaults.json << 'EOF'
{
  "userPreferences": {
    "rate": 0.15,
    "serviceUrl": "http://localhost:3060",
    "evaluationEnabled": true,
    "evaluationWeight": 0.2,
    "evaluationMode": "additive"
  }
}
EOF
```

### Example 3: Update Global Defaults via API

```bash
# Enable user preferences with moderate influence
curl -X PUT http://localhost:3005/api/config/global-defaults \
  -H "Content-Type: application/json" \
  -d '{
    "userPreferencesRate": 0.2,
    "userPreferenceEvaluationEnabled": true,
    "userPreferenceEvaluationWeight": 0.25,
    "userPreferenceEvaluationMode": "additive"
  }'
```

### Example 4: Run with Custom Overrides

```bash
# Start a run with higher user preference influence
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "quality-musicality",
    "options": {
      "userPreferencesRate": 0.5,
      "userPreferenceEvaluationWeight": 0.5
    }
  }'
```

---

## Verification

### Test Global Defaults Are Applied

1. Set a global default:
   ```bash
   GLOBAL_USER_PREFERENCES_RATE=0.25 npm start
   ```

2. Start a run and check the working config:
   ```bash
   # Start a run
   curl -X POST http://localhost:3005/api/runs \
     -d '{"templateName": "quality-musicality"}'

   # Check the generated config
   cat working/{runId}/evolution-run-config.jsonc | jq '.classifiers[0].classConfigurations[0].userPreferencesRate'
   # Should output: 0.25
   ```

### Test Configuration Priority

1. Set global default to 0.1
2. Set template default to 0.2
3. POST request with rate: 0.3
4. Verify working config has 0.3 (request wins)

---

## How It Works

### Parent Selection Flow

When generating a new genome, the QD search checks sources in this order:

1. **User Preferences** (if `userPreferencesRate > 0` and `random() < userPreferencesRate`)
   - Selects a genome from user-liked sounds
   - Strategy determines selection bias (weighted/uniform)

2. **Novelty Archive** (if enabled and `random() < inspirationRate`)
   - Selects from the novelty archive

3. **Elite Map** (default)
   - Selects from the current elite archive

### Evaluation Augmentation Flow

After computing the standard quality score (`newGenomeClassScores`):

1. Calculate similarity to user preference embeddings
2. Aggregate similarity across users (max/mean/weighted_mean)
3. Apply based on mode:
   - **Additive:** `finalScore = originalScore + (weight × similarity)`
   - **Multiplicative:** `finalScore = originalScore × (1 + weight × similarity)`
   - **Filter:** Reject if `similarity < threshold`

---

## Troubleshooting

### User Preferences Not Applied

1. Check kromosynth-recommend is running at the configured URL
2. Verify users have liked sounds in the database
3. Check logs for cache initialization messages

### Low Impact from User Preferences

1. Increase `userPreferencesRate` (try 0.3-0.5 for testing)
2. Increase `userPreferenceEvaluationWeight`
3. Check that `userPreferenceEvaluationEnabled` is `true`

### Cache Not Refreshing

1. Check `userPreferencesCacheRefreshInterval` setting
2. Verify network connectivity to kromosynth-recommend
3. Check for errors in logs

---

## Related Documentation

- [README.md](./README.md) - Evolution Manager overview
- [TEMPLATE_CREATION_GUIDE.md](./TEMPLATE_CREATION_GUIDE.md) - Creating configuration templates
- [SERVICE_DEPENDENCY_GUIDE.md](./SERVICE_DEPENDENCY_GUIDE.md) - Service dependencies
