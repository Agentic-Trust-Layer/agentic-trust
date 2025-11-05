/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agentic-trust/core'],
  webpack: (config, { isServer }) => {
    // Externalize Node.js modules for server-side
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
      { module: /node_modules/ },
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];

    return config;
  },
};

module.exports = nextConfig;

