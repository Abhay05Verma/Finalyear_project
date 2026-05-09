require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Database connection
const { sequelize } = require('./config/database');
const { SensorNode, Location } = require('./models');

// Import routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const sensorRoutes = require('./routes/sensors');
const alertRoutes = require('./routes/alerts');
const nodeRoutes = require('./routes/nodes');
const adminRoutes = require('./routes/admin');

// Import services
const websocketService = require('./services/websocketService');
const thingspeakService = require('./services/thingspeakService');
const alertService = require('./services/alertService');
const aiPredictionService = require('./services/aiPredictionService');
const sensorHealthService = require('./services/sensorHealthService');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Initialize express app
const app = express();
const server = http.createServer(app);
const publicDir = path.resolve(__dirname, '..', 'public');
const PORT = process.env.PORT || 3001;

const parseOriginList = (...values) =>
  values
    .flatMap((value) => String(value || '').split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);

const toWebSocketOrigin = (origin) => {
  if (origin.startsWith('https://')) {
    return origin.replace('https://', 'wss://');
  }

  if (origin.startsWith('http://')) {
    return origin.replace('http://', 'ws://');
  }

  return origin;
};

const allowedOrigins = [
  ...new Set(
    parseOriginList(
      process.env.FRONTEND_URL,
      process.env.APP_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:3000',
      `http://localhost:${PORT}`
    )
  )
];

const cspConnectSrc = [
  "'self'",
  ...new Set([
    ...allowedOrigins,
    ...allowedOrigins.map(toWebSocketOrigin),
    'https://api.thingspeak.com',
    'https://cdn.jsdelivr.net',
    'https://cdn.socket.io'
  ])
];

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Initialize WebSocket service
websocketService.init(io);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com"
        ],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://cdn.socket.io",
          "https://code.jquery.com"
        ],

        scriptSrcAttr: [
          "'unsafe-inline'"
        ],

        fontSrc: [
          "'self'",
          "https://cdnjs.cloudflare.com"
        ],

        connectSrc: [
          ...cspConnectSrc
        ],

        imgSrc: [
          "'self'",
          "data:",
          "https://cdnjs.cloudflare.com"
        ]
      }
    }
  })
);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Avoid noisy 404s when no favicon file is present.
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Serve static files from top-level public directory
app.use(express.static(publicDir));

// Rate limiting
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', apiLimiter);



// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/admin', adminRoutes);

// Serve frontend (if integrated)
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: sequelize.connectionManager.pool ? 'connected' : 'disconnected'
  });
});

// AI health check endpoint
app.get('/api/ai/health', async (req, res) => {
  try {
    const health = await aiPredictionService.getHealthStatus();
    res.status(health.ready ? 200 : 503).json(health);
  } catch (error) {
    res.status(500).json({
      ready: false,
      error: error.message,
      checked_at: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use(errorHandler);

// Start data fetching services
thingspeakService.startDataFetching();
alertService.startAlertMonitoring();
sensorHealthService.startMonitoring();

const ensureBackendSchema = async () => {
  const [mobileColumn] = await sequelize.query(`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'mobile_number'
    LIMIT 1
  `);

  if (mobileColumn.length === 0) {
    await sequelize.query(`
      ALTER TABLE users
      ADD COLUMN mobile_number VARCHAR(20) NULL AFTER email
    `);
    console.log('Added users.mobile_number column');
  }
};

const ensureMockRaigarhNode = async () => {
  const [raigarhLocation] = await Location.findOrCreate({
    where: { name: 'Raigarh' },
    defaults: {
      name: 'Raigarh',
      description: 'Mock monitoring site for node 2',
      latitude: 21.8974,
      longitude: 83.3957,
      altitude: 219.0,
      region: 'Chhattisgarh',
      risk_level: 'medium',
      is_active: true
    }
  });

  const [nodeTwo] = await SensorNode.findOrCreate({
    where: { node_id: 'NODE-002' },
    defaults: {
      node_id: 'NODE-002',
      name: 'Raigarh Mock Node',
      location_id: raigarhLocation.id,
      sensor_type: 'multi',
      status: 'online',
      battery_level: 81,
      firmware_version: 'mock-v1',
      installation_date: new Date()
    }
  });

  const desiredNodeState = {
    name: 'Raigarh Mock Node',
    location_id: raigarhLocation.id,
    sensor_type: nodeTwo.sensor_type || 'multi',
    is_active: true
  };

  const requiresUpdate =
    nodeTwo.name !== desiredNodeState.name ||
    nodeTwo.location_id !== desiredNodeState.location_id ||
    nodeTwo.is_active !== desiredNodeState.is_active;

  if (requiresUpdate) {
    await nodeTwo.update(desiredNodeState);
  }
};

const startServer = async () => {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('âœ… Database connection established successfully.');

    await ensureBackendSchema();
    
    // Avoid automatic ALTER sync by default; it can create excessive indexes over time.
    const enableSchemaAlter =
      process.env.DB_SYNC_ALTER === 'true' && process.env.NODE_ENV === 'development';
    await sequelize.sync({ alter: enableSchemaAlter });
    console.log('âœ… Database synchronized (alter=).');
    await ensureMockRaigarhNode();
    try {
      const aiHealth = await aiPredictionService.getHealthStatus();
      console.log('[AI] Startup status:', {
        ready: aiHealth.ready,
        python: aiHealth.python.version || aiHealth.python.executable,
        model_exists: aiHealth.files.model.exists,
        predict_script_exists: aiHealth.files.predict_script.exists
      });
    } catch (aiError) {
      console.error('[AI] Startup health check failed:', aiError.message);
    }
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the existing server process and retry.`);
      } else {
        console.error('Server startup error:', error);
      }
      process.exit(1);
    });
    server.listen(PORT, () => {
      console.log(`ðŸš€ Server running on port ${PORT}`);
      console.log(`ðŸŒ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`ðŸ”— API Base URL: http://localhost:${PORT}/api`);
      console.log(`ðŸ“¡ WebSocket URL: ws://localhost:${PORT}`);
      console.log(`ðŸ“Š ThingSpeak Integration: ${process.env.THINGSPEAK_API_KEY ? 'Active' : 'Not configured'}`);
    });
  } catch (error) {
    console.error('âŒ Unable to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

// Start the server
startServer();

  
