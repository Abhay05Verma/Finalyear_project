const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SensorNode = sequelize.define('SensorNode', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  node_id: {
    type: DataTypes.STRING(50),
    unique: true,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  location_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  sensor_type: {
    type: DataTypes.ENUM('rainfall', 'soil_moisture', 'tilt', 'vibration', 'temperature', 'multi'),
    defaultValue: 'multi'
  },
  status: {
    type: DataTypes.ENUM('online', 'offline', 'maintenance'),
    defaultValue: 'offline'
  },
  battery_level: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 100.00
  },
  last_seen: {
    type: DataTypes.DATE
  },
  firmware_version: {
    type: DataTypes.STRING(20)
  },
  hardware_version: {
    type: DataTypes.STRING(20)
  },
  installation_date: {
    type: DataTypes.DATEONLY
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'sensor_nodes',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['node_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['location_id']
    },
    {
      fields: ['last_seen']
    }
  ]
});

// Associations
SensorNode.associate = (models) => {
  SensorNode.belongsTo(models.Location, {
    foreignKey: 'location_id',
    as: 'location'
  });
  
  SensorNode.hasMany(models.SensorData, {
    foreignKey: 'node_id',
    sourceKey: 'node_id',
    as: 'sensor_data'
  });
  
  SensorNode.hasMany(models.Alert, {
    foreignKey: 'node_id',
    sourceKey: 'node_id',
    as: 'alerts'
  });
};

module.exports = SensorNode;