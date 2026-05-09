const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize, SensorData, SensorNode, Location } = require('../models');
const { authMiddleware } = require('../middleware/auth');

const VALID_PARAMETERS = new Set([
  'rainfall',
  'soil_moisture',
  'tilt',
  'vibration',
  'temperature',
  'pressure',
  'battery',
  'signal_strength',
  'risk_score'
]);

const VALID_DATA_INTERVALS = new Set(['raw', 'hourly', 'daily']);
const VALID_HISTORICAL_INTERVALS = new Set(['minutely', 'hourly', 'daily']);


// Get sensor data with filters
router.get('/data', authMiddleware, async (req, res) => {
  try {
    const {
      node_id,
      location_id,
      parameter,
      start_time,
      end_time,
      interval = 'raw',
      limit = 100
    } = req.query;

    if (parameter && !VALID_PARAMETERS.has(parameter)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid parameter'
      });
    }

    if (!VALID_DATA_INTERVALS.has(interval)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid interval'
      });
    }

    let whereClause = {};
    
    if (node_id) whereClause.node_id = node_id;
    if (location_id) whereClause.location_id = location_id;
    
    if (start_time || end_time) {
      whereClause.reading_timestamp = {};
      if (start_time) whereClause.reading_timestamp[Op.gte] = new Date(start_time);
      if (end_time) whereClause.reading_timestamp[Op.lte] = new Date(end_time);
    }

    let data;
    
    if (interval === 'raw') {
      // Raw data
      data = await SensorData.findAll({
        where: whereClause,
        include: [
          {
            model: SensorNode,
            as: 'sensor_node',
            attributes: ['name']
          },
          {
            model: Location,
            as: 'location',
            attributes: ['name']
          }
        ],
        order: [['reading_timestamp', 'DESC']],
        limit: parseInt(limit)
      });
    } else {
      // Aggregated data
      let groupBy, format;
      
      switch (interval) {
        case 'hourly':
          groupBy = sequelize.fn('DATE_FORMAT', sequelize.col('reading_timestamp'), '%Y-%m-%d %H:00:00');
          format = '%Y-%m-%d %H:00:00';
          break;
        case 'daily':
          groupBy = sequelize.fn('DATE', sequelize.col('reading_timestamp'));
          format = '%Y-%m-%d';
          break;
        default:
          groupBy = sequelize.fn('DATE_FORMAT', sequelize.col('reading_timestamp'), '%Y-%m-%d %H:00:00');
          format = '%Y-%m-%d %H:00:00';
      }

      const attributes = [
        [groupBy, 'time_period'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'readings_count']
      ];

      // Add parameter-specific aggregations if specified
      if (parameter) {
        const metricExpr = parameter === 'tilt'
          ? sequelize.fn(
              'GREATEST',
              sequelize.fn('ABS', sequelize.col('tilt_x')),
              sequelize.fn('ABS', sequelize.col('tilt_y'))
            )
          : sequelize.col(parameter);

        attributes.push(
          [sequelize.fn('AVG', metricExpr), `avg_${parameter}`],
          [sequelize.fn('MAX', metricExpr), `max_${parameter}`],
          [sequelize.fn('MIN', metricExpr), `min_${parameter}`]
        );
      } else {
        // Default aggregations for all parameters
        const parameters = ['rainfall', 'soil_moisture', 'vibration', 'risk_score'];
        parameters.forEach(param => {
          attributes.push(
            [sequelize.fn('AVG', sequelize.col(param)), `avg_${param}`],
            [sequelize.fn('MAX', sequelize.col(param)), `max_${param}`]
          );
        });
      }

      data = await SensorData.findAll({
        where: whereClause,
        attributes: attributes,
        group: ['time_period'],
        order: [['time_period', 'ASC']],
        raw: true
      });
    }

    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching sensor data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sensor data'
    });
  }
});

// Get historical data for specific parameter (public read-only)
router.get('/data/historical', async (req, res) => {
  try {
    const {
      node_id,
      location_id,
      parameter,
      hours,
      start_time,
      end_time,
      interval = 'hourly'
    } = req.query;

    if (!parameter || !VALID_PARAMETERS.has(parameter)) {
      return res.status(400).json({
        success: false,
        error: 'Valid parameter is required'
      });
    }

    if (!VALID_HISTORICAL_INTERVALS.has(interval)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid interval'
      });
    }

    const whereClause = {};
    if (node_id) whereClause.node_id = node_id;
    if (location_id) whereClause.location_id = location_id;
    
    if (start_time || end_time) {
      whereClause.reading_timestamp = {};
      if (start_time) whereClause.reading_timestamp[Op.gte] = new Date(start_time);
      if (end_time) whereClause.reading_timestamp[Op.lte] = new Date(end_time);
    }

    // If `hours` is provided (from dashboard UI), use it as time window.
    if (!start_time && !end_time && hours) {
      const hoursBack = parseInt(hours, 10);
      const fromTime = new Date(Date.now() - (Number.isFinite(hoursBack) ? hoursBack : 24) * 60 * 60 * 1000);
      whereClause.reading_timestamp = {
        [Op.gte]: fromTime
      };
    } else if (!start_time && !end_time) {
      // Default to last 24 hours if no time range specified
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      whereClause.reading_timestamp = {
        [Op.gte]: yesterday
      };
    }

    let groupBy, timeFormat;
    
    switch (interval) {
      case 'minutely':
        groupBy = sequelize.fn('DATE_FORMAT', sequelize.col('reading_timestamp'), '%Y-%m-%d %H:%i:00');
        timeFormat = '%Y-%m-%d %H:%i:00';
        break;
      case 'hourly':
        groupBy = sequelize.fn('DATE_FORMAT', sequelize.col('reading_timestamp'), '%Y-%m-%d %H:00:00');
        timeFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'daily':
        groupBy = sequelize.fn('DATE', sequelize.col('reading_timestamp'));
        timeFormat = '%Y-%m-%d';
        break;
      default:
        groupBy = sequelize.fn('DATE_FORMAT', sequelize.col('reading_timestamp'), '%Y-%m-%d %H:00:00');
        timeFormat = '%Y-%m-%d %H:00:00';
    }

    const isTilt = parameter === 'tilt';
    const selectedMetricExpr = isTilt
      ? sequelize.fn(
          'GREATEST',
          sequelize.fn('ABS', sequelize.col('tilt_x')),
          sequelize.fn('ABS', sequelize.col('tilt_y'))
        )
      : sequelize.col(parameter);

    const attributes = [
      [groupBy, 'timestamp'],
      [sequelize.fn('AVG', selectedMetricExpr), `avg_${parameter}`],
      [sequelize.fn('MAX', selectedMetricExpr), `max_${parameter}`],
      [sequelize.fn('MIN', selectedMetricExpr), `min_${parameter}`],
      [sequelize.fn('COUNT', sequelize.col('id')), 'readings_count']
    ];

    // Keep backward compatibility for generic tilt while also supporting X/Y charting.
    if (isTilt) {
      attributes.push(
        [sequelize.fn('AVG', sequelize.col('tilt_x')), 'avg_tilt_x'],
        [sequelize.fn('AVG', sequelize.col('tilt_y')), 'avg_tilt_y'],
        [sequelize.fn('MAX', sequelize.col('tilt_x')), 'max_tilt_x'],
        [sequelize.fn('MAX', sequelize.col('tilt_y')), 'max_tilt_y'],
        [sequelize.fn('MIN', sequelize.col('tilt_x')), 'min_tilt_x'],
        [sequelize.fn('MIN', sequelize.col('tilt_y')), 'min_tilt_y']
      );
    }

    const historicalData = await SensorData.findAll({
      where: whereClause,
      attributes,
      group: ['timestamp'],
      order: [['timestamp', 'ASC']],
      raw: true
    });

    res.json({
      success: true,
      data: historicalData,
      parameter: parameter,
      interval: interval
    });
  } catch (error) {
    console.error('Error fetching historical data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch historical data'
    });
  }
});

// Get latest readings for all nodes
router.get('/data/latest', authMiddleware, async (req, res) => {
  try {
    // Get latest reading for each node
    const subquery = sequelize.literal(`(
      SELECT MAX(sd2.reading_timestamp)
      FROM sensor_data sd2
      WHERE sd2.node_id = SensorData.node_id
    )`);

    const latestData = await SensorData.findAll({
      where: {
        reading_timestamp: subquery
      },
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name', 'status', 'battery_level']
        },
        {
          model: Location,
          as: 'location',
          attributes: ['name', 'risk_level']
        }
      ],
      order: [['node_id', 'ASC']]
    });

    res.json({
      success: true,
      data: latestData.map(data => data.toJSON()),
      count: latestData.length
    });
  } catch (error) {
    console.error('Error fetching latest data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest data'
    });
  }
});

// Add manual sensor reading (for testing)
router.post('/data', authMiddleware, async (req, res) => {
  try {
    const {
      node_id,
      location_id,
      rainfall,
      soil_moisture,
      tilt_x,
      tilt_y,
      vibration,
      temperature,
      pressure,
      battery
    } = req.body;

    // Validate required fields
    if (!node_id || !location_id) {
      return res.status(400).json({
        success: false,
        error: 'Node ID and Location ID are required'
      });
    }

    // Calculate risk score
    const { calculateRiskScore, determineRiskLevel } = require('../services/riskCalculationService');
    const riskScore = calculateRiskScore(
      rainfall || 0,
      soil_moisture || 0,
      tilt_x || 0,
      tilt_y || 0,
      vibration || 0
    );
    const riskLevel = determineRiskLevel(riskScore);

    // Create sensor data
    const sensorData = await SensorData.create({
      node_id,
      location_id,
      rainfall,
      soil_moisture,
      tilt_x,
      tilt_y,
      vibration,
      temperature,
      pressure,
      battery,
      risk_score: riskScore,
      risk_level: riskLevel,
      reading_timestamp: new Date()
    });

    // Update node status
    await SensorNode.update({
      last_seen: new Date(),
      status: 'online',
      battery_level: battery
    }, {
      where: { node_id }
    });

    // Check for alerts
    const alertService = require('../services/alertService');
    await alertService.checkForAlerts(sensorData);

    // Broadcast via WebSocket
    const websocketService = require('../services/websocketService');
    websocketService.broadcastSensorUpdate(sensorData);

    res.json({
      success: true,
      message: 'Sensor data added successfully',
      data: sensorData.toJSON()
    });
  } catch (error) {
    console.error('Error adding sensor data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add sensor data'
    });
  }
});

// Export sensor data
router.get('/data/export', authMiddleware, async (req, res) => {
  try {
    const { format = 'csv', start_time, end_time } = req.query;
    
    const whereClause = {};
    if (start_time || end_time) {
      whereClause.reading_timestamp = {};
      if (start_time) whereClause.reading_timestamp[Op.gte] = new Date(start_time);
      if (end_time) whereClause.reading_timestamp[Op.lte] = new Date(end_time);
    }

    const data = await SensorData.findAll({
      where: whereClause,
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name']
        },
        {
          model: Location,
          as: 'location',
          attributes: ['name']
        }
      ],
      order: [['reading_timestamp', 'DESC']],
      limit: 1000
    });

    if (format === 'csv') {
      // Convert to CSV
      const csvData = data.map(record => {
        const row = {
          Timestamp: record.reading_timestamp,
          'Node ID': record.node_id,
          'Node Name': record.sensor_node ? record.sensor_node.name : '',
          'Location': record.location ? record.location.name : '',
          'Rainfall (mm/hr)': record.rainfall,
          'Soil Moisture (%)': record.soil_moisture,
          'Tilt X (°)': record.tilt_x,
          'Tilt Y (°)': record.tilt_y,
          'Vibration (g)': record.vibration,
          'Temperature (°C)': record.temperature,
          'Pressure (hPa)': record.pressure,
          'Battery (%)': record.battery,
          'Risk Score': record.risk_score,
          'Risk Level': record.risk_level
        };
        return Object.values(row).join(',');
      });

      const headers = 'Timestamp,Node ID,Node Name,Location,Rainfall (mm/hr),Soil Moisture (%),Tilt X (°),Tilt Y (°),Vibration (g),Temperature (°C),Pressure (hPa),Battery (%),Risk Score,Risk Level';
      const csvContent = [headers, ...csvData].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=sensor_data.csv');
      res.send(csvContent);
    } else {
      // JSON format
      res.json({
        success: true,
        data: data.map(d => d.toJSON()),
        count: data.length
      });
    }
  } catch (error) {
    console.error('Error exporting sensor data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export sensor data'
    });
  }
});

module.exports = router;
