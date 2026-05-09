const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SensorData = sequelize.define('SensorData', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  node_id: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  location_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  rainfall: {
    type: DataTypes.DECIMAL(6, 2),
    comment: 'mm/hr'
  },
  soil_moisture: {
    type: DataTypes.DECIMAL(5, 2),
    comment: 'percentage'
  },
  tilt_x: {
    type: DataTypes.DECIMAL(5, 2),
    comment: 'degrees'
  },
  tilt_y: {
    type: DataTypes.DECIMAL(5, 2),
    comment: 'degrees'
  },
  vibration: {
    type: DataTypes.DECIMAL(5, 3),
    comment: 'g-force'
  },
  temperature: {
    type: DataTypes.DECIMAL(5, 2),
    comment: 'celsius'
  },
  pressure: {
    type: DataTypes.DECIMAL(7, 2),
    comment: 'hPa'
  },
  battery: {
    type: DataTypes.DECIMAL(5, 2),
    comment: 'percentage'
  },
  signal_strength: {
    type: DataTypes.DECIMAL(5, 2),
    comment: 'dBm'
  },
  risk_score: {
    type: DataTypes.TINYINT,
    comment: '0-100 percentage',
    defaultValue: 0
  },
  risk_level: {
    type: DataTypes.ENUM('normal', 'low', 'medium', 'high', 'critical'),
    defaultValue: 'normal'
  },
  reading_timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'sensor_data',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['node_id', 'reading_timestamp']
    },
    {
      fields: ['location_id', 'reading_timestamp']
    },
    {
      fields: ['risk_level']
    },
    {
      fields: ['reading_timestamp']
    },
    {
      fields: ['risk_score']
    }
  ]
});

// Associations
SensorData.associate = (models) => {
  SensorData.belongsTo(models.SensorNode, {
    foreignKey: 'node_id',
    targetKey: 'node_id',
    as: 'sensor_node'
  });
  
  SensorData.belongsTo(models.Location, {
    foreignKey: 'location_id',
    as: 'location'
  });
};

module.exports = SensorData;