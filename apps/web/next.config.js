/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agentic-trust/core'],
      webpack: (config, { isServer }) => {
        // Mark Node.js modules as external for client-side builds
        // These modules are only available server-side
        if (!isServer) {
          config.resolve.fallback = {
            ...config.resolve.fallback,
            fs: false,
            path: false,
            url: false,
            module: false,
          };
        }

    // Mark @metamask/delegation-toolkit and 'module' as external for server-side
    // These are Node.js built-ins that should not be bundled
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('@metamask/delegation-toolkit', 'module');
      } else if (typeof config.externals === 'function') {
        const originalExternals = config.externals;
        config.externals = [
          originalExternals,
          (context, request, callback) => {
            if (request === '@metamask/delegation-toolkit' || 
                request.startsWith('@metamask/') ||
                request === 'module') {
              return callback(null, 'commonjs ' + request);
            }
            callback();
          },
        ];
      }
    }

    // Suppress webpack warnings about dynamic imports
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /node_modules\/@metamask\/delegation-toolkit/ },
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];

    return config;
  },
};

module.exports = nextConfig;

