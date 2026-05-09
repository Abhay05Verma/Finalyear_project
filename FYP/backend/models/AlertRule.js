const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AlertRule = sequelize.define('AlertRule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT
  },
  parameter: {
    type: DataTypes.ENUM('rainfall', 'soil_moisture', 'tilt', 'vibration', 'temperature', 'risk_score', 'battery'),
    allowNull: false
  },
  operator: {
    type: DataTypes.ENUM('>', '>=', '<', '<=', '=', '!='),
    allowNull: false
  },
  threshold_value: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
    comment: 'Condition must persist for this many minutes'
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    defaultValue: 'medium'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  location_id: {
    type: DataTypes.INTEGER,
    comment: 'NULL means applies to all locations'
  },
  created_by: {
    type: DataTypes.INTEGER
  }
}, {
  tableName: 'alert_rules',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['parameter']
    },
    {
      fields: ['severity']
    },
    {
      fields: ['is_active']
    }
  ]
});

// Associations
AlertRule.associate = (models) => {
  AlertRule.belongsTo(models.Location, {
    foreignKey: 'location_id',
    as: 'location'
  });
  
  AlertRule.belongsTo(models.User, {
    foreignKey: 'created_by',
    as: 'creator'
  });
  
  AlertRule.hasMany(models.Alert, {
    foreignKey: 'alert_rule_id',
    as: 'alerts'
  });
};

module.exports = AlertRule;