const path = require('path');
const os = require('os');

const usingSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const allowedDevOrigins = Object.values(os.networkInterfaces())
  .flat()
  .filter((networkAddress) => networkAddress && !networkAddress.internal && networkAddress.family === 'IPv4')
  .map((networkAddress) => networkAddress.address);

// Security headers on every page. The Content-Security-Policy lets the page talk only to this server,
// the Supabase project and Google Fonts, so injected scripts cannot send data anywhere else.
function securityHeaders() {
  const sb = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbWs = sb.replace(/^http/, 'ws');
  const csp = [
    "default-src 'self'",
    // Next.js puts small inline scripts in each page; 'unsafe-eval' is only needed by the dev server.
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${sb}`.trim(),
    `connect-src 'self' ${sb} ${sbWs}`.trim(),
    `frame-src 'self' blob: ${sb}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  agentRules: false,
  allowedDevOrigins,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  webpack(config, { webpack }) {
    // Production (Supabase) builds must NOT ship the demo dataset inside the public JS bundle.
    if (usingSupabase) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/tasks-seed\.json$/, path.resolve(__dirname, 'lib/empty-seed.json'))
      );
    }
    return config;
  },
};

module.exports = nextConfig;
