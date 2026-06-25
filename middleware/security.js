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
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // Limit each IP to 120 requests per minute
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:"], // unsafe-inline/unsafe-eval needed for inline scripts and templates; blob: for workers
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for inline styling/attributes
      imgSrc: ["'self'", "data:"], // data: needed for SVG previews
      fontSrc: ["'self'", "data:"], // data: needed for base64 encoded woff/woff2 fonts
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
