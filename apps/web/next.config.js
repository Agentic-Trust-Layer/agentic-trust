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

    // Mark @metamask/delegation-toolkit as external for server-side
    // It's dynamically imported at runtime and may not be installed
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('@metamask/delegation-toolkit');
      } else if (typeof config.externals === 'function') {
        const originalExternals = config.externals;
        config.externals = [
          originalExternals,
          (context, request, callback) => {
            if (request === '@metamask/delegation-toolkit' || 
                request.startsWith('@metamask/')) {
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

