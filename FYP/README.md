# Landslide Early Warning System

A full-stack Landslide Early Warning System (EWS) for monitoring sensor data, calculating risk, generating alerts, and providing a real-time dashboard for operators, administrators, and view-only users.

## Overview

This project combines:

- A Node.js and Express backend
- A MySQL database with Sequelize models
- A browser-based monitoring dashboard
- ThingSpeak integration for IoT sensor ingestion
- WebSocket updates with Socket.IO
- AI-assisted risk prediction using Python
- Email and SMS alert notifications

The system is designed to collect environmental sensor readings such as rainfall, soil moisture, tilt, vibration, temperature, pressure, and battery level, then convert those readings into risk scores, alerts, and visual monitoring tools.

## Main Features

### User and Access Management

- User signup, login, logout, and profile management
- Login with username, email, or mobile number
- Role-based access control for `admin`, `operator`, `viewer`, and `visitor`
- Guest mode for view-only access
- JWT-based authentication

### Monitoring Dashboard

- Real-time dashboard with current landslide risk level
- Node status overview
- Recent sensor data summary
- Recent alerts summary
- Historical charts and trend analysis
- Alerts, nodes, and admin sections in the UI

### Sensor Data Management

- Ingest sensor readings from ThingSpeak
- Manual sensor data creation for testing
- Raw and aggregated sensor data queries
- Historical data endpoints
- CSV and JSON export support

### Alerting

- Threshold-based alert generation
- Severity levels: `low`, `medium`, `high`, `critical`
- Alert acknowledgment and bulk acknowledgment
- Unacknowledged alert tracking
- Alert escalation for unresolved alerts
- Offline node detection and alert generation
- Custom alert rule management

### Notifications

- Email alert dispatch
- SMS alert dispatch through MSG91
- Per-user notification preferences
- Severity-based notification filtering
- SMS delivery logging and retry support

### AI Prediction

- Python-based landslide risk prediction integrated into the Node.js backend
- Seven sensor inputs used for inference: rainfall, soil moisture, tilt x/y, vibration, temperature, and pressure
- Engineered features such as tilt magnitude and sensor interaction terms
- AI health check endpoint for Python, model, and script readiness
- Automatic fallback heuristic risk scoring when AI is unavailable
- High-risk AI alert creation with cooldown protection

### Admin Features

- User management
- System statistics and recent activity
- Configuration view
- System component testing
- Database maintenance endpoints
- System log viewer

### Realtime Features

- Live sensor updates
- Live risk updates
- Live alert broadcasts
- Live node status updates
- Connection count broadcast

## Project Structure

```text
FYP/
|-- backend/
|   |-- ai/                  # Python model, training script, prediction script
|   |-- config/              # Database and ThingSpeak configuration
|   |-- database/            # SQL schema and migrations
|   |-- middleware/          # Auth and error middleware
|   |-- models/              # Sequelize models
|   |-- routes/              # API route modules
|   |-- scripts/             # Cron and support scripts
|   |-- services/            # Business logic and integrations
|   |-- utils/               # Helpers, seeders, validation, logging
|   `-- server.js            # Main backend entry point
|-- public/
|   `-- index.html           # Frontend dashboard
`-- README.md
```

## Technology Stack

### Backend

- Node.js
- Express
- Sequelize
- MySQL
- Socket.IO
- JWT
- Joi
- Axios
- Nodemailer

### Frontend

- HTML
- Bootstrap 5
- jQuery
- Chart.js
- Socket.IO client

### AI / Data Science

- Python
- Pandas and NumPy for feature preparation
- Scikit-learn for training and inference
- Joblib for serialized model artifacts

## Functional Modules

### 1. Authentication Module

Implemented in:

- `backend/routes/auth.js`
- `backend/middleware/auth.js`

Capabilities:

- Public signup
- Admin-created users
- Login using username, email, or mobile number
- JWT token generation
- Profile view and profile update
- Notification settings management

### 2. Dashboard Module

Implemented in:

- `backend/routes/dashboard.js`
- `public/index.html`

Capabilities:

- Overview statistics
- Overall risk score and risk level
- Recent sensor readings
- Recent alerts
- Risk trends
- Realtime reading endpoint

### 3. Sensor Data Module

Implemented in:

- `backend/routes/sensors.js`
- `backend/services/thingspeakService.js`

Capabilities:

- Query sensor data with filters
- Historical data with multiple intervals
- Latest reading per node
- Manual reading insertion for testing
- Data export as CSV or JSON
- Scheduled ThingSpeak ingestion

### 4. Alert Module

Implemented in:

- `backend/routes/alerts.js`
- `backend/services/alertService.js`

Capabilities:

- Create alerts from sensor conditions
- View alerts and filter them
- View unacknowledged alerts
- Acknowledge alerts
- Bulk acknowledge alerts
- Create, update, delete alert rules
- Escalate unresolved alerts
- Create offline node alerts

### 5. Sensor Node Module

Implemented in:

- `backend/routes/nodes.js`

Capabilities:

- List nodes
- View node details
- Create, update, delete nodes
- Node health scoring
- Low battery detection
- Potential offline detection
- Simulated restart

### 6. Admin Module

Implemented in:

- `backend/routes/admin.js`

Capabilities:

- User management
- System stats
- Location listing
- Configuration view and update
- Database maintenance actions
- Logs endpoint
- Integration test endpoints

### 7. WebSocket Module

Implemented in:

- `backend/services/websocketService.js`

Capabilities:

- Authenticated Socket.IO connections
- Guest WebSocket mode
- Room-based subscriptions by location
- Real-time sensor, risk, alert, and node status events

### 8. AI Prediction Module

Implemented in:

- `backend/services/aiPredictionService.js`
- `backend/ai/predict.py`
- `backend/ai/train_model.py`

Purpose:

- Convert live sensor readings into a landslide risk probability
- Standardize AI output into backend-friendly risk score and risk level values
- Keep the monitoring pipeline working even if Python or the model is unavailable

Inference flow:

1. The backend receives a new sensor reading.
2. `aiPredictionService.js` resolves the Python executable and builds the CLI arguments.
3. The Node service runs `predict.py` with the latest sensor values.
4. `predict.py` loads the trained `landslide_model.pkl` artifact.
5. Base sensor inputs are expanded into engineered features before inference.
6. The Python script returns JSON with `prediction` and `probability`.
7. The backend converts the probability into:
   - `riskScore` from `0` to `100`
   - `riskLevel` as `low`, `medium`, or `high`
8. If the AI step fails or times out, the backend uses fallback heuristic scoring instead of blocking the pipeline.

Model inputs:

- `rainfall`
- `soil_moisture`
- `tilt_x`
- `tilt_y`
- `vibration`
- `temperature`
- `pressure`

Engineered features created in Python:

- `tilt_magnitude`
- `tilt_abs_delta`
- `rain_soil_interaction`
- `rain_tilt_interaction`
- `vibration_tilt_interaction`
- `temp_pressure_interaction`

Prediction output:

- `prediction`: binary class where `1` means elevated landslide likelihood
- `probability`: normalized probability between `0.0` and `1.0`
- `riskScore`: rounded percentage derived from probability
- `riskLevel` thresholds:
  - `low` for probability below `0.35`
  - `medium` for probability from `0.35` to below `0.70`
  - `high` for probability `0.70` or above

Health and resilience:

- The AI health status checks:
  - Python availability and version
  - existence of `predict.py`
  - existence of `landslide_model.pkl`
- Prediction execution is bounded by `AI_PREDICTION_TIMEOUT_MS`
- If Python returns invalid JSON, exits with an error, or the model file is missing, the backend falls back safely
- Cooldown settings are used to avoid repeated AI-related alert noise

Training pipeline:

- `train_model.py` trains the model from a CSV dataset
- Required dataset columns:
  - the seven base sensor features above
  - `landslide` as the binary target
- The script:
  - validates the dataset
  - generates engineered features
  - splits data into train and test sets
  - evaluates multiple candidate models
  - selects the best model by cross-validated accuracy
  - saves the trained artifact with metadata and feature names
  - writes evaluation metrics to JSON

Candidate models:

- Logistic Regression
- Random Forest
- Extra Trees
- HistGradientBoosting

Generated files:

- `backend/ai/landslide_model.pkl` for inference
- `backend/ai/training_metrics.json` for training results

AI-specific environment variables:

- `PYTHON_EXECUTABLE`
- `AI_PREDICTION_TIMEOUT_MS`
- `AI_HIGH_RISK_ALERT_COOLDOWN_MINUTES`
- `AI_FALLBACK_ALERT_COOLDOWN_MINUTES`

Operational notes:

- The Node.js backend auto-discovers a local Windows Python install if `PYTHON_EXECUTABLE` is not set
- The Python inference script accepts sensor values as positional CLI arguments
- The final model artifact may store both the trained estimator and the feature list used during training

### 9. Notification Module

Implemented in:

- `backend/services/smsService.js`
- `backend/services/alertService.js`

Capabilities:

- Email dispatch via SMTP
- SMS dispatch via MSG91
- User-specific notification filtering
- Severity-based notification control
- Retry and logging for SMS

## Database Entities

The backend uses Sequelize models for the main domain objects, including:

- `User`
- `Notification`
- `SensorNode`
- `SensorData`
- `Location`
- `Alert`
- `AlertRule`
- `SmsLog`
- `HourlyAggregatedData`
- `DailyAggregatedData`

The base SQL schema is available in:

- `backend/database/landslide_ews.sql`

Additional migration-like SQL files are also present in:

- `backend/database/`

## API Summary

### Auth Routes

Base path: `/api/auth`

- `POST /signup`
- `POST /register`
- `POST /login`
- `POST /logout`
- `GET /profile`
- `PUT /profile`
- `GET /notification-settings`
- `PUT /notification-settings`

### Dashboard Routes

Base path: `/api/dashboard`

- `GET /overview`
- `GET /risk-trends`
- `GET /statistics`
- `GET /realtime`

### Sensor Routes

Base path: `/api/sensors`

- `GET /data`
- `GET /data/historical`
- `GET /data/latest`
- `POST /data`
- `GET /data/export`

### Alert Routes

Base path: `/api/alerts`

- `GET /`
- `GET /unacknowledged`
- `GET /:id`
- `POST /:id/acknowledge`
- `GET /stats/summary`
- `POST /rules`
- `GET /rules`
- `PUT /rules/:id`
- `DELETE /rules/:id`
- `POST /bulk-acknowledge`

### Node Routes

Base path: `/api/nodes`

- `GET /`
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`
- `GET /status/summary`
- `GET /:id/health`
- `POST /:id/restart`

### Admin Routes

Base path: `/api/admin`

- `GET /system-stats`
- `GET /users`
- `GET /locations`
- `POST /users`
- `PUT /users/:id`
- `DELETE /users/:id`
- `GET /configuration`
- `PUT /configuration`
- `POST /database/maintenance`
- `GET /logs`
- `POST /test`

### General Health Routes

- `GET /health`
- `GET /api/ai/health`

## Environment Variables

Create a `.env` file inside `backend/` and configure the values below as needed.

### Core App

```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
JWT_SECRET=your_jwt_secret
DISABLE_AUTH=false
DB_SYNC_ALTER=false
```

### Database

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=landslide_ews
DB_USER=root
DB_PASSWORD=your_password
```

### ThingSpeak

```env
THINGSPEAK_API_KEY=your_api_key
THINGSPEAK_CHANNEL_1=your_channel_id
THINGSPEAK_READ_KEY_1=your_read_key
THINGSPEAK_FETCH_INTERVAL=20000
THINGSPEAK_MAX_DATA_AGE_MS=900000
THINGSPEAK_ALLOW_STALE=false
```

### AI

```env
PYTHON_EXECUTABLE=python
AI_PREDICTION_TIMEOUT_MS=8000
AI_HIGH_RISK_ALERT_COOLDOWN_MINUTES=15
AI_FALLBACK_ALERT_COOLDOWN_MINUTES=10
THRESHOLD_ALERT_COOLDOWN_MINUTES=15
```

### Email

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email_user
SMTP_PASSWORD=your_email_password
EMAIL_FROM=alerts@example.com
```

### SMS / MSG91

```env
MSG91_AUTH_KEY=your_msg91_key
MSG91_TEMPLATE_ID=your_template_id
MSG91_SENDER_ID=your_sender_id
MSG91_COUNTRY=91
MSG91_FLOW_URL=https://control.msg91.com/api/v5/flow/
SMS_MIN_SEVERITY=high
SMS_TIMEOUT_MS=10000
SMS_MAX_RETRIES=2
SMS_LOG_TO_DB=true
```

## Installation and Setup

### Prerequisites

- Node.js 16 or newer
- MySQL server
- Python installed for AI prediction

### 1. Install backend dependencies

```powershell
cd backend
npm install
```

### 2. Configure the database

- Create the MySQL database
- Import the schema from `backend/database/landslide_ews.sql`
- Add any additional SQL changes from files in `backend/database/`

### 3. Configure environment variables

- Create `backend/.env`
- Add the values required for your local environment

### 4. Seed initial data if needed

```powershell
cd backend
npm run seed
```

### 5. Start the backend

```powershell
cd backend
npm start
```

For development mode:

```powershell
cd backend
npm run dev
```

### 6. Open the dashboard

Visit:

```text
http://localhost:3001
```

## Available NPM Scripts

Defined in `backend/package.json`:

```powershell
npm start
npm run dev
npm run seed
npm run cron:fetch
npm run cron:alerts
npm run ai:train
npm run ai:predict:sample
```

## Runtime Flow

1. The backend starts and connects to MySQL.
2. Static frontend files are served from `public/`.
3. ThingSpeak polling begins automatically.
4. Incoming sensor data is parsed and stored.
5. AI prediction is attempted for each new reading.
6. If AI is unavailable, heuristic risk scoring is used.
7. Alert rules are evaluated.
8. Alerts are saved and dispatched through WebSocket, email, and SMS.
9. The frontend dashboard updates in real time.

## Default Access Notes

The frontend currently shows a default admin hint in the login modal:

- Username: `admin`
- Password: `Admin123!`

Use this only if that account exists in your seeded database.

## Security Notes

- Authentication is required for protected APIs.
- `DISABLE_AUTH=true` should only be used for isolated local debugging.
- Rate limiting is applied to `/api/`.
- Helmet and CORS are enabled.
- Do not commit production secrets into source control.

## Known Operational Notes

- ThingSpeak polling starts automatically when the server starts.
- AI health depends on both Python availability and the model file existing.
- Email and SMS are best-effort integrations and depend on external configuration.
- The project includes logic to automatically ensure the `mobile_number` column exists on startup.

## Future Improvement Ideas

- Add automated tests for routes and services
- Move frontend code into a separate modular frontend app
- Add a dedicated configuration table instead of static config responses
- Replace mock system logs with persistent log storage
- Add deployment documentation
- Add API request and response examples

## Authoring Notes

This documentation was written from the current project structure and implemented code in:

- `backend/server.js`
- `backend/routes/`
- `backend/services/`
- `backend/models/`
- `public/index.html`
