const http = require('http');

// 1. Disable 300-second requestTimeout in Node.js 18+ HTTP server
try {
  const origCreateServer = http.createServer;
  http.createServer = function (opts, requestListener) {
    const server = origCreateServer.apply(this, arguments);
    server.requestTimeout = 0; // Disable 300s timeout so long vision OCR requests are not cut off
    server.headersTimeout = 0;
    server.keepAliveTimeout = 600000;
    return server;
  };
} catch (e) {
  console.warn('[next.config.js] Could not patch http.createServer timeout:', e);
}

// 2. Configure undici Agent with 0 headersTimeout/bodyTimeout (defaults are 300s)
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  const globalOcrAgent = new Agent({
    headersTimeout: 0, // 0 = no timeout
    bodyTimeout: 0,    // 0 = no timeout
    connectTimeout: 60000,
    keepAliveTimeout: 300000,
  });
  setGlobalDispatcher(globalOcrAgent);
} catch (e) {
  console.warn('[next.config.js] Could not set undici global dispatcher:', e);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Increase payload size for audio uploads
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  httpAgentOptions: {
    keepAlive: true,
  },
  async rewrites() {
    const backendUrl = process.env.INTERNAL_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        // Allow CORS for all API routes so React Native app and web clients can communicate seamlessly
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT,OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Groq-Api-Key',
          },
        ],
      },
    ];
  },
};


module.exports = nextConfig;

