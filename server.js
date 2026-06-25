const express = require('express');
const session = require('express-session');
const path = require('path');
const compression = require('compression');
const dotenv = require('dotenv');

dotenv.config();

const { pool } = require('./config/db');
const DrizzleSessionStore = require('./config/sessionStore');
const { helmetConfig, globalLimiter } = require('./middleware/security');
const queueService = require('./services/QueueService');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.use(globalLimiter);

app.use(helmetConfig);

app.use(session({
  name: 'gdrive_sess_id',
  store: new DrizzleSessionStore(),
  secret: process.env.SESSION_SECRET || 'gdrive_session_backup_secret_key',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  res.locals.userId = req.session?.userId || null;
  res.locals.userName = req.session?.userName || null;
  res.locals.userEmail = req.session?.userEmail || null;
  next();
});

app.locals.formatBytes = function(bytes) {
  if (bytes === 0 || !bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const authRouter = require('./routes/auth');
const driveRouter = require('./routes/drive');
const shareRouter = require('./routes/share');
const previewRouter = require('./routes/preview');

app.use('/auth', authRouter);
app.use('/share', shareRouter);
app.use('/preview', previewRouter);
app.use('/', driveRouter);

app.get('/drive', (req, res) => {
  res.redirect('/');
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'CSRF token verification failed. Please reload the page.' });
  }
  console.error('Unhandled server error:', err.stack);
  res.status(500).send('Internal Server Error');
});

async function initializeServer() {
  console.log('Verifying database pool connection...');
  try {
    const conn = await pool.getConnection();
    console.log('MySQL Database connection verified successfully.');
    conn.release();

    try {
      const [tableCheck] = await pool.query("SHOW TABLES LIKE 'files'");
      if (tableCheck.length > 0) {
        const [indexCheck] = await pool.query("SHOW INDEX FROM files WHERE Key_name = 'idx_search'");
        if (indexCheck.length === 0) {
          await pool.query("ALTER TABLE files ADD FULLTEXT INDEX idx_search (filename, original_name)");
          console.log('Applied MySQL FULLTEXT index (idx_search) on files table.');
        }
      } else {
        console.warn('Files table not found. Please run Drizzle migrations or push scheme.');
      }
    } catch (indexErr) {
      console.warn('Notice: Could not enforce FULLTEXT index on boot:', indexErr.message);
    }

    queueService.start();

    app.listen(PORT, () => {
      console.log(`Server started in ${process.env.NODE_ENV} mode.`);
      console.log(`Running on http://127.0.0.1:${PORT}`);
    });
  } catch (dbErr) {
    console.error('CRITICAL: Failed to connect to MySQL database:', dbErr.message);
    console.error('Please verify that MySQL is active and the credentials in .env are correct.');
    process.exit(1);
  }
}

initializeServer();
