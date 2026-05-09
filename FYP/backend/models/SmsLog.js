const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SmsLog = sequelize.define('SmsLog', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  alert_id: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  mobile_number: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'MSG91'
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'skipped'),
    allowNull: false,
    defaultValue: 'pending'
  },
  attempt_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  severity: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  location_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  provider_response: {
    type: DataTypes.TEXT('long'),
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'sms_logs',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['alert_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    }
  ]
});

SmsLog.associate = (models) => {
  SmsLog.belongsTo(models.Alert, {
    foreignKey: 'alert_id',
    as: 'alert'
  });
};

module.exports = SmsLog;
