const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Alert = sequelize.define('Alert', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  alert_rule_id: {
    type: DataTypes.INTEGER
  },
  node_id: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  location_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  alert_type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: false
  },
  parameter_value: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false
  },
  parameter_threshold: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false
  },
  is_acknowledged: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  acknowledged_by: {
    type: DataTypes.INTEGER
  },
  acknowledged_at: {
    type: DataTypes.DATE
  },
  resolved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  resolved_at: {
    type: DataTypes.DATE
  }
}, {
  tableName: 'alerts',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['created_at']
    },
    {
      fields: ['severity']
    },
    {
      fields: ['is_acknowledged']
    },
    {
      fields: ['node_id']
    },
    {
      fields: ['location_id']
    },
    {
      fields: ['alert_type']
    }
  ]
});

// Associations
Alert.associate = (models) => {
  Alert.belongsTo(models.AlertRule, {
    foreignKey: 'alert_rule_id',
    as: 'alert_rule'
  });
  
  Alert.belongsTo(models.SensorNode, {
    foreignKey: 'node_id',
    targetKey: 'node_id',
    as: 'sensor_node'
  });
  
  Alert.belongsTo(models.Location, {
    foreignKey: 'location_id',
    as: 'location'
  });
  
  Alert.belongsTo(models.User, {
    foreignKey: 'acknowledged_by',
    as: 'acknowledged_by_user'
  });

  Alert.hasMany(models.SmsLog, {
    foreignKey: 'alert_id',
    as: 'sms_logs'
  });
};

module.exports = Alert;
