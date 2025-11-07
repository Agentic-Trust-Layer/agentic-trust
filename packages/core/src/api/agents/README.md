# Reusable API Route Handlers

This directory contains reusable API route handlers that can be used across all Next.js apps.

## Automatic Route Generation (Recommended)

The core library includes route templates and a sync script that automatically generates route files in apps.

### Quick Start

Run the sync script to generate route files for all apps:

```bash
# From root directory - syncs to all apps (only creates routes allowed for each app type)
pnpm sync-routes

# Or for a specific app
pnpm --filter @agentic-trust/core sync-routes admin
pnpm --filter @agentic-trust/core sync-routes web
pnpm --filter @agentic-trust/core sync-routes provider
```

### Route App Type Restrictions

Some routes are only available for specific app types:
- **`/api/agents/create`**: Only available for admin apps (requires admin privileges)

### Force Overwrite

To overwrite existing route files (useful when updating templates):

```bash
pnpm sync-routes --force
```

### How It Works

1. Route templates are stored in `packages/core/src/api/agents/create/route.template.ts`
2. The sync script copies templates to apps, replacing placeholders with app-specific values:
   - `getClient` → `getAdminClient` (admin), `getAgentTrustClient` (web), etc.
   - Import paths are adjusted per app
3. Generated files are placed in `apps/{app}/src/app/api/agents/create/route.ts`

## Manual Usage

If you prefer to create routes manually, import and use the `handleCreateAgent` function:

```typescript
// apps/your-app/src/app/api/agents/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { handleCreateAgent } from '@agentic-trust/core/server';
import { getYourClient } from '@/lib/client'; // Your app-specific client getter

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await handleCreateAgent(body, getYourClient);
    
    // Check if result is an error
    if ('error' in result) {
      const status = result.error.includes('Missing required') || result.error.includes('Invalid') ? 400 : 500;
      return NextResponse.json(result, { status });
    }
    
    // Success response
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in create agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to create agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
```

## Benefits

- **DRY (Don't Repeat Yourself)**: Shared logic across all apps
- **Consistency**: Same validation and error handling everywhere
- **Maintainability**: Update once, applies to all apps
- **Type Safety**: Full TypeScript support with exported types
- **Auto-Generation**: Route files can be automatically synced from templates
- **No Manual Copying**: Run `pnpm sync-routes` to generate routes for all apps

## Adding New Routes

To add a new route template:

1. Create a template file: `packages/core/src/api/agents/{route}/route.template.ts`
2. Add it to `ROUTES` array in `packages/core/scripts/sync-routes.js`
3. Configure app-specific replacements
4. Run `pnpm sync-routes` to generate route files
