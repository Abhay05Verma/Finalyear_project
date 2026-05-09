const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const HourlyAggregatedData = sequelize.define('HourlyAggregatedData', {
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
  hour_start: {
    type: DataTypes.DATE,
    allowNull: false
  },
  rainfall_total: {
    type: DataTypes.DECIMAL(8, 2),
    defaultValue: 0
  },
  rainfall_max: {
    type: DataTypes.DECIMAL(6, 2),
    defaultValue: 0
  },
  soil_moisture_avg: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  tilt_x_max: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  tilt_y_max: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  vibration_max: {
    type: DataTypes.DECIMAL(5, 3),
    defaultValue: 0
  },
  temperature_avg: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  risk_score_avg: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  risk_score_max: {
    type: DataTypes.TINYINT,
    defaultValue: 0
  },
  risk_level: {
    type: DataTypes.ENUM('normal', 'low', 'medium', 'high', 'critical'),
    defaultValue: 'normal'
  },
  readings_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'hourly_aggregated_data',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['hour_start']
    },
    {
      fields: ['location_id', 'hour_start']
    },
    {
      fields: ['risk_level']
    }
  ]
});

// Associations
HourlyAggregatedData.associate = (models) => {
  HourlyAggregatedData.belongsTo(models.SensorNode, {
    foreignKey: 'node_id',
    targetKey: 'node_id',
    as: 'sensor_node'
  });
  
  HourlyAggregatedData.belongsTo(models.Location, {
    foreignKey: 'location_id',
    as: 'location'
  });
};

module.exports = HourlyAggregatedData;