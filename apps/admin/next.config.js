/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agentic-trust/core', '@agentic-trust/8004-ext-sdk', '@agentic-trust/8004-sdk'],
  async rewrites() {
    return [
      // OWLAPI/Protégé dereferences `.../ontology/X#` as `.../ontology/X` (fragment not sent over HTTP).
      // Serve the actual ontology files from their IRI paths.
      {
        source: '/ontology/agentictrust-core',
        destination: '/ontology/agentictrust-core.owl',
      },
      {
        source: '/ontology/agentictrust-eth',
        destination: '/ontology/agentictrust-eth.owl',
      },
      // Back-compat: old base IRI (if referenced anywhere) points at the core ontology.
      {
        source: '/ontology/agentictrust',
        destination: '/ontology/agentictrust-core.owl',
      },
      // And for ontology IRIs like `.../ontology/ERC8004#` and `.../ontology/ERC8092#`.
      {
        source: '/ontology/ERC8004',
        destination: '/ontology/ERC8004.owl',
      },
      {
        source: '/ontology/ERC8092',
        destination: '/ontology/ERC8092.owl',
      },
      {
        source: '/ontology/hol',
        destination: '/ontology/hol.owl',
      },
    ];
  },
  async headers() {
    return [
      {
        // These ontology files are Turtle syntax (despite .owl extension), so advertise accordingly.
        source: '/ontology/agentictrust-core.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/agentictrust-core',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/agentictrust-eth.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/agentictrust-eth',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        // Back-compat IRI path content-type.
        source: '/ontology/agentictrust',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/ERC8004.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/ERC8004',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/ERC8092.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/ERC8092',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/hol.owl',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/hol',
        headers: [{ key: 'Content-Type', value: 'text/turtle; charset=utf-8' }],
      },
      {
        source: '/ontology/catalog-v001.xml',
        headers: [{ key: 'Content-Type', value: 'application/xml; charset=utf-8' }],
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

