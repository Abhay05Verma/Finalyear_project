const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  email_notifications: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  push_notifications: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  sms_notifications: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  low_severity: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  medium_severity: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  high_severity: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  critical_severity: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  notification_frequency: {
    type: DataTypes.ENUM('immediate', 'hourly', 'daily'),
    defaultValue: 'immediate'
  }
}, {
  tableName: 'notification_settings',
  timestamps: true,
  underscored: true
});

// Associations
Notification.associate = (models) => {
  Notification.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Notification;