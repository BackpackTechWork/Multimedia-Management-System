const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per window
  message: { error: 'Too many authentication attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const globalLimiter = rateLimit({
  // Navigation, previews, and refreshes can each generate many requests.
  // Keep a generous burst allowance with a short, automatic recovery window.
  windowMs: 30 * 1000,
  max: 600, // Limit each IP to 600 requests per 30 seconds
  handler: (req, res) => {
    const retryAfterSeconds = Math.max(1, Math.ceil(
      ((req.rateLimit.resetTime?.getTime() || Date.now() + 30000) - Date.now()) / 1000
    ));
    res.setHeader('Retry-After', retryAfterSeconds);
    res.status(429).json({
      error: `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
      retryAfterSeconds,
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => (
    req.path.startsWith('/api/upload/') ||
    (req.method === 'POST' && req.path === '/api/folders') ||
    (req.method === 'POST' && /^\/share\/[^/]+\/upload(?:\/refresh-stats)?$/.test(req.path)) ||
    (req.method === 'POST' && /^\/share\/[^/]+\/folders$/.test(req.path))
  ),
});

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "blob:",
        "https://static.cloudflareinsights.com"
      ], // Cloudflare injects its Web Analytics beacon when Browser Insights is enabled.
      connectSrc: ["'self'", "https://cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for inline styling/attributes
      imgSrc: ["'self'", "data:", "blob:"], // data: needed for SVG previews
      fontSrc: ["'self'", "data:"], // data: needed for base64 encoded woff/woff2 fonts
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'self'"], // needed for PDF embed iframe/object
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"], // blob: needed for web workers (e.g., PDF.js worker)
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Prevents iframe blockages for previews
  crossOriginResourcePolicy: { policy: "cross-origin" }
});

const csrfProtection = csrf({ cookie: false }); // session-based CSRF

module.exports = {
  authLimiter,
  globalLimiter,
  helmetConfig,
  csrfProtection
};
