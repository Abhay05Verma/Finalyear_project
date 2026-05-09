const { sequelize } = require('../config/database');
const User = require('./User');
const Location = require('./Location');
const SensorNode = require('./SensorNode');
const SensorData = require('./SensorData');
const Alert = require('./Alert');
const AlertRule = require('./AlertRule');
const Notification = require('./Notification');
const HourlyAggregatedData = require('./HourlyAggregatedData');
const DailyAggregatedData = require('./DailyAggregatedData');
const SmsLog = require('./SmsLog');

// Initialize models
const models = {
  User,
  Location,
  SensorNode,
  SensorData,
  Alert,
  AlertRule,
  Notification,
  HourlyAggregatedData,
  DailyAggregatedData,
  SmsLog
};

// Set up associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

module.exports = {
  sequelize,
  ...models
};
