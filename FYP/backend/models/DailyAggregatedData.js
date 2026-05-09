const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DailyAggregatedData = sequelize.define('DailyAggregatedData', {
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
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  rainfall_total: {
    type: DataTypes.DECIMAL(10, 2),
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
  tilt_max: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  vibration_max: {
    type: DataTypes.DECIMAL(5, 3),
    defaultValue: 0
  },
  temperature_min: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  temperature_max: {
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
  tableName: 'daily_aggregated_data',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['date']
    },
    {
      fields: ['location_id', 'date']
    }
  ]
});

// Associations
DailyAggregatedData.associate = (models) => {
  DailyAggregatedData.belongsTo(models.SensorNode, {
    foreignKey: 'node_id',
    targetKey: 'node_id',
    as: 'sensor_node'
  });
  
  DailyAggregatedData.belongsTo(models.Location, {
    foreignKey: 'location_id',
    as: 'location'
  });
};

module.exports = DailyAggregatedData;