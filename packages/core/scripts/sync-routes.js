#!/usr/bin/env node

/**
 * Sync API route files from core library to apps
 * 
 * This script copies route templates from core to apps, replacing placeholders
 * with app-specific values.
 * 
 * Usage: 
 *   pnpm --filter @agentic-trust/core sync-routes [app-name] [--force]
 *   node packages/core/scripts/sync-routes.js [app-name] [--force]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPS = ['admin', 'web', 'provider'];
const CORE_DIR = path.join(__dirname, '..');
// ROOT_DIR should be two levels up from scripts/ (scripts -> core -> packages -> root)
const ROOT_DIR = path.join(__dirname, '../../..');

// Route templates to sync
// Each route can specify which app types it should be synced to
const ROUTES = [
  {
    template: 'src/api/agents/create-for-eoa/route.template.ts',
    target: 'src/app/api/agents/create-for-eoa/route.ts',
    // Only sync this route to admin apps
    allowedApps: ['admin'],
    replacements: {
      admin: { 
        getClient: 'getAdminClient',
        importPath: '@/lib/client'
      },
      // Note: web and provider are not allowed for this route, but kept for reference
      web: { 
        getClient: 'getAgentTrustClient',
        importPath: '@/lib/server-client'
      },
      provider: { 
        getClient: 'getAgenticTrustClient',
        importPath: '@/lib/client'
      },
    },
  },
  {
    template: 'src/api/agents/getAgentInfo/route.template.ts',
    target: 'src/app/api/agents/[agentId]/route.ts',
    // Only sync this route to admin apps
    allowedApps: ['admin'],
    replacements: {
      admin: { 
        getClient: 'getAdminClient',
        importPath: '@/lib/client'
      },
      web: { 
        getClient: 'getAgentTrustClient',
        importPath: '@/lib/server-client'
      },
      provider: { 
        getClient: 'getAgenticTrustClient',
        importPath: '@/lib/client'
      },
    },
  },
];

function syncRoute(appName, route) {
  const templatePath = path.join(CORE_DIR, route.template);
  const appDir = path.join(ROOT_DIR, 'apps', appName);
  const targetPath = path.join(appDir, route.target);
  const targetDir = path.dirname(targetPath);

  // Debug logging
  if (process.env.DEBUG) {
    console.log(`Template: ${templatePath}`);
    console.log(`Target: ${targetPath}`);
    console.log(`Template exists: ${fs.existsSync(templatePath)}`);
  }

  // Read template
  if (!fs.existsSync(templatePath)) {
    console.warn(`Template not found: ${templatePath}`);
    return;
  }

  let content = fs.readFileSync(templatePath, 'utf-8');

  // Apply replacements
  const replacements = route.replacements[appName];
  if (replacements) {
    // Replace getClient function name
    if (replacements.getClient) {
      content = content.replace(/getClient/g, replacements.getClient);
    }
    // Replace import path
    if (replacements.importPath) {
      content = content.replace(/from ['"]@\/lib\/client['"]/g, `from '${replacements.importPath}'`);
    }
  }

  // Create target directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Write file (only if it doesn't exist or if --force flag is set)
  const force = process.argv.includes('--force');
  if (!fs.existsSync(targetPath) || force) {
    fs.writeFileSync(targetPath, content, 'utf-8');
    console.log(`✅ Synced ${route.target} to ${appName}`);
  } else {
    console.log(`⏭️  Skipped ${route.target} in ${appName} (already exists, use --force to overwrite)`);
  }
}

function main() {
  // Filter out flags from arguments
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const appArg = args[0];
  const appsToSync = appArg ? [appArg] : APPS;

  console.log('🔄 Syncing API routes from core library...\n');

  appsToSync.forEach((appName) => {
    if (!APPS.includes(appName)) {
      console.error(`❌ Unknown app: ${appName}. Available apps: ${APPS.join(', ')}`);
      return;
    }

    console.log(`📦 Syncing routes for ${appName}...`);
    ROUTES.forEach((route) => {
      // Check if this route is allowed for this app
      if (route.allowedApps && !route.allowedApps.includes(appName)) {
        console.log(`⏭️  Skipped ${route.target} in ${appName} (not allowed for this app type)`);
        return;
      }
      syncRoute(appName, route);
    });
    console.log('');
  });

  console.log('✅ Route sync complete!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { syncRoute, ROUTES, APPS };

