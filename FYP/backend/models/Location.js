const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Location = sequelize.define('Location', {
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
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: false
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: false
  },
  altitude: {
    type: DataTypes.DECIMAL(8, 2)
  },
  region: {
    type: DataTypes.STRING(100)
  },
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    defaultValue: 'low'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'locations',
  timestamps: true,
  underscored: true
});

// Associations
Location.associate = (models) => {
  Location.hasMany(models.SensorNode, {
    foreignKey: 'location_id',
    as: 'sensor_nodes'
  });
  
  Location.hasMany(models.SensorData, {
    foreignKey: 'location_id',
    as: 'sensor_data'
  });
  
  Location.hasMany(models.Alert, {
    foreignKey: 'location_id',
    as: 'alerts'
  });
  
  Location.hasMany(models.AlertRule, {
    foreignKey: 'location_id',
    as: 'alert_rules'
  });
};

module.exports = Location;