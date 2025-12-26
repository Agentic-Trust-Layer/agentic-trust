/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agentic-trust/core', '@agentic-trust/8004-ext-sdk', '@agentic-trust/8004-sdk'],
  async rewrites() {
    return [
      // OWLAPI/Protégé will dereference `.../ontology/agentictrust#` as `.../ontology/agentictrust`
      // (fragment not sent over HTTP). Serve the actual ontology file from that IRI.
      {
        source: '/ontology/agentictrust',
        destination: '/ontology/agentictrust.owl',
      },
      // Same pattern for the ERC-8004/8092 layered ontology.
      {
        source: '/ontology/8004agent',
        destination: '/ontology/8004agent.owl',
      },
    ];
  },
  async headers() {
    return [
      {
        // This file is Turtle syntax (despite .owl extension), so advertise accordingly.
        source: '/ontology/agentictrust.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        // And ensure the import IRI gets the same content-type.
        source: '/ontology/agentictrust',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/8004agent.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/8004agent',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
    ];
  },
  eslint: {
    // Don't fail build on ESLint warnings
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Speed up `next build` by skipping Next.js' built-in typecheck.
    // Run `pnpm -C apps/admin type-check` (or `turbo run type-check`) in CI / pre-merge.
    // Set NEXT_STRICT_TYPECHECK=true to restore build-time typechecking.
    ignoreBuildErrors: process.env.NEXT_STRICT_TYPECHECK !== 'true',
  },
  webpack: (config, { isServer }) => {
    // Configure module resolution for workspace packages
    // Ensure TypeScript source is preferred over compiled JS
    config.resolve = {
      ...config.resolve,
      extensions: ['.ts', '.tsx', '.js', '.jsx', ...(config.resolve.extensions || [])],
    };

    // Externalize Node.js modules for server-side
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('@metamask/smart-accounts-kit', 'module');
      } else if (typeof config.externals === 'function') {
        const originalExternals = config.externals;
        config.externals = [
          originalExternals,
          (context, request, callback) => {
            if (request === '@metamask/smart-accounts-kit' || 
                request.startsWith('@metamask/') ||
                request === 'module') {
              return callback(null, 'commonjs ' + request);
            }
            callback();
          },
        ];
      }
    }

    // For client-side builds, exclude Node.js modules and server-only code
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
      
      // Use IgnorePlugin to prevent sessionPackage from being bundled
      const webpack = require('webpack');
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /sessionPackage/,
          contextRegExp: /@agentic-trust\/core/,
        })
      );
    }

    // Suppress webpack warnings about dynamic imports
    config.ignoreWarnings = [
      { module: /node_modules/ },
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];

    return config;
  },
};

module.exports = nextConfig;

