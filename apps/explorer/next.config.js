/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agentic-trust/core'],
  webpack: (config, { isServer }) => {
    // Externalize Node.js built-in 'module' for server-side
    // This allows @agentic-trust/core to use createRequire in Next.js
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('module');
      } else if (typeof config.externals === 'function') {
        const originalExternals = config.externals;
        config.externals = [
          originalExternals,
          (context, request, callback) => {
            if (request === 'module') {
              return callback(null, 'commonjs ' + request);
            }
            callback();
          },
        ];
      }
    }
    return config;
  },
};

module.exports = nextConfig;

