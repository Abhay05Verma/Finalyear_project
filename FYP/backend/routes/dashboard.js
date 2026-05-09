const express = require('express');
const { Op, fn, col } = require('sequelize');
const { SensorData, SensorNode, Alert, Location } = require('../models');

const router = express.Router();
const ADMIN_ONLY_ALERT_PATTERN = 'sensor_health_%';

const parseInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildDashboardFilters = async ({ nodeId, locationId }) => {
  let selectedNode = null;
  let selectedLocation = null;

  if (nodeId) {
    selectedNode = await SensorNode.findOne({
      where: { node_id: nodeId, is_active: true },
      include: [
        {
          model: Location,
          as: 'location',
          attributes: ['id', 'name', 'region', 'risk_level']
        }
      ]
    });

    if (!selectedNode) {
      return { error: 'Selected node was not found' };
    }

    selectedLocation = selectedNode.location || null;
  }

  if (locationId) {
    const location = await Location.findOne({
      where: { id: locationId, is_active: true },
      attributes: ['id', 'name', 'region', 'risk_level']
    });

    if (!location) {
      return { error: 'Selected location was not found' };
    }

    selectedLocation = location;

    if (selectedNode && selectedNode.location_id !== location.id) {
      return { error: 'Selected node does not belong to the selected location' };
    }
  }

  const sensorDataWhere = {};
  const nodeWhere = { is_active: true };
  const alertWhere = {};

  if (selectedLocation) {
    sensorDataWhere.location_id = selectedLocation.id;
    nodeWhere.location_id = selectedLocation.id;
    alertWhere.location_id = selectedLocation.id;
  }

  if (selectedNode) {
    sensorDataWhere.node_id = selectedNode.node_id;
    nodeWhere.node_id = selectedNode.node_id;
    alertWhere.node_id = selectedNode.node_id;
  }

  return {
    sensorDataWhere,
    nodeWhere,
    alertWhere,
    selectedNode,
    selectedLocation
  };
};

async function getDashboardCatalog(selectedLocationId = null) {
  const locationFilter = { is_active: true };
  if (selectedLocationId) {
    locationFilter.id = selectedLocationId;
  }

  const locations = await Location.findAll({
    where: locationFilter,
    attributes: ['id', 'name', 'region', 'risk_level'],
    include: [
      {
        model: SensorNode,
        as: 'sensor_nodes',
        where: { is_active: true },
        required: false,
        attributes: ['id', 'node_id', 'name', 'status', 'battery_level', 'last_seen'],
        order: [['name', 'ASC']]
      }
    ],
    order: [['name', 'ASC']]
  });

  const mappedLocations = locations.map((location) => {
    const json = location.toJSON();
    return {
      id: json.id,
      name: json.name,
      region: json.region,
      risk_level: json.risk_level,
      nodes: (json.sensor_nodes || []).map((node) => ({
        id: node.id,
        node_id: node.node_id,
        name: node.name,
        status: node.status,
        battery_level: node.battery_level,
        last_seen: node.last_seen,
        location_id: json.id,
        location_name: json.name
      }))
    };
  });

  return {
    locations: mappedLocations,
    nodes: mappedLocations.flatMap((location) => location.nodes)
  };
}

router.get('/catalog', async (req, res) => {
  try {
    const locationId = parseInteger(req.query.location_id);
    const catalog = await getDashboardCatalog(locationId);

    res.json({
      success: true,
      ...catalog
    });
  } catch (error) {
    console.error('Error fetching dashboard catalog:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard catalog'
    });
  }
});

// Dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const locationId = parseInteger(req.query.location_id);
    const nodeId = String(req.query.node_id || '').trim() || null;
    const filters = await buildDashboardFilters({ nodeId, locationId });

    if (filters.error) {
      return res.status(400).json({
        success: false,
        error: filters.error
      });
    }

    const {
      sensorDataWhere,
      nodeWhere,
      alertWhere,
      selectedNode,
      selectedLocation
    } = filters;

    const nodeStats = await SensorNode.findAll({
      where: nodeWhere,
      attributes: [
        'status',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    const totalReadings = await SensorData.count({
      where: sensorDataWhere
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayReadings = await SensorData.count({
      where: {
        ...sensorDataWhere,
        reading_timestamp: { [Op.gte]: today }
      }
    });

    const unacknowledgedAlerts = await Alert.count({
      where: {
        ...alertWhere,
        is_acknowledged: false
      }
    });

    const todayAlerts = await Alert.count({
      where: {
        ...alertWhere,
        created_at: { [Op.gte]: today }
      }
    });

    const latestData = await SensorData.findAll({
      where: sensorDataWhere,
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name', 'node_id', 'status', 'battery_level']
        },
        {
          model: Location,
          as: 'location',
          attributes: ['id', 'name', 'region', 'risk_level']
        }
      ],
      order: [['reading_timestamp', 'DESC']],
      limit: selectedNode ? 1 : 5
    });

    const overallRisk = latestData.length
      ? latestData.reduce((sum, data) => sum + data.risk_score, 0) / latestData.length
      : 0;

    let riskLevel = 'normal';
    if (overallRisk > 80) riskLevel = 'critical';
    else if (overallRisk > 60) riskLevel = 'high';
    else if (overallRisk > 40) riskLevel = 'medium';
    else if (overallRisk > 20) riskLevel = 'low';

    const nodeStatus = { online: 0, offline: 0, maintenance: 0, total: 0 };
    nodeStats.forEach((stat) => {
      nodeStatus[stat.status] = parseInt(stat.count, 10);
      nodeStatus.total += parseInt(stat.count, 10);
    });

    const catalog = await getDashboardCatalog();

    res.json({
      success: true,
      selection: {
        location_id: selectedLocation ? selectedLocation.id : null,
        location_name: selectedLocation ? selectedLocation.name : null,
        node_id: selectedNode ? selectedNode.node_id : null,
        node_name: selectedNode ? selectedNode.name : null
      },
      overview: {
        overall_risk: {
          score: Math.round(overallRisk),
          level: riskLevel
        },
        node_status: nodeStatus,
        alerts: {
          unacknowledged: unacknowledgedAlerts,
          total_today: todayAlerts
        },
        statistics: {
          total_readings: totalReadings,
          today_readings: todayReadings,
          total_nodes: nodeStatus.total
        }
      },
      latest_data: latestData.map((data) => ({
        ...data.toJSON(),
        node_name: data.sensor_node ? data.sensor_node.name : null,
        location_name: data.location ? data.location.name : null
      })),
      recent_alerts: await getRecentAlerts(5, alertWhere),
      available_locations: catalog.locations,
      available_nodes: catalog.nodes
    });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

// Risk trends
router.get('/risk-trends', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const locationId = parseInteger(req.query.location_id);
    const nodeId = String(req.query.node_id || '').trim() || null;
    const filters = await buildDashboardFilters({ nodeId, locationId });

    if (filters.error) {
      return res.status(400).json({
        success: false,
        error: filters.error
      });
    }

    const timeAgo = new Date();
    timeAgo.setHours(timeAgo.getHours() - parseInt(hours, 10));

    const whereClause = {
      ...filters.sensorDataWhere,
      reading_timestamp: { [Op.gte]: timeAgo }
    };

    const hourBucket = fn('DATE_FORMAT', col('reading_timestamp'), '%Y-%m-%d %H:00:00');

    const riskTrends = await SensorData.findAll({
      where: whereClause,
      attributes: [
        [hourBucket, 'hour'],
        [fn('AVG', col('risk_score')), 'avg_risk_score'],
        [fn('MAX', col('risk_score')), 'max_risk_score'],
        [fn('COUNT', col('id')), 'readings_count']
      ],
      group: [hourBucket],
      order: [[hourBucket, 'ASC']],
      raw: true
    });

    res.json({
      success: true,
      data: riskTrends
    });
  } catch (error) {
    console.error('Error fetching risk trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch risk trends'
    });
  }
});

// Statistics
router.get('/statistics', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;

    const timeAgo = new Date();
    switch (timeframe) {
      case '1h':
        timeAgo.setHours(timeAgo.getHours() - 1);
        break;
      case '6h':
        timeAgo.setHours(timeAgo.getHours() - 6);
        break;
      case '24h':
        timeAgo.setDate(timeAgo.getDate() - 1);
        break;
      case '7d':
        timeAgo.setDate(timeAgo.getDate() - 7);
        break;
      case '30d':
        timeAgo.setDate(timeAgo.getDate() - 30);
        break;
      default:
        timeAgo.setDate(timeAgo.getDate() - 1);
    }

    const stats = await SensorData.findAll({
      where: {
        reading_timestamp: { [Op.gte]: timeAgo }
      },
      attributes: [
        [fn('AVG', col('rainfall')), 'avg_rainfall'],
        [fn('MAX', col('rainfall')), 'max_rainfall'],
        [fn('AVG', col('soil_moisture')), 'avg_soil_moisture'],
        [fn('MAX', col('soil_moisture')), 'max_soil_moisture'],
        [fn('AVG', col('vibration')), 'avg_vibration'],
        [fn('MAX', col('vibration')), 'max_vibration'],
        [fn('AVG', col('risk_score')), 'avg_risk_score'],
        [fn('MAX', col('risk_score')), 'max_risk_score'],
        [fn('COUNT', col('id')), 'total_readings']
      ],
      raw: true
    });

    res.json({
      success: true,
      statistics: stats[0] || {}
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

// Realtime
router.get('/realtime', async (req, res) => {
  try {
    const latestData = await SensorData.findOne({
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name', 'status']
        },
        {
          model: Location,
          as: 'location',
          attributes: ['name', 'risk_level']
        }
      ],
      order: [['reading_timestamp', 'DESC']]
    });

    if (!latestData) {
      return res.status(404).json({
        success: false,
        error: 'No sensor data found'
      });
    }

    res.json({
      success: true,
      data: latestData.toJSON()
    });
  } catch (error) {
    console.error('Error fetching real-time data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch real-time data'
    });
  }
});

async function getRecentAlerts(limit = 10, baseWhere = {}) {
  try {
    const alerts = await Alert.findAll({
      where: {
        ...baseWhere,
        alert_type: {
          [Op.notLike]: ADMIN_ONLY_ALERT_PATTERN
        }
      },
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
      order: [['created_at', 'DESC']],
      limit
    });

    return alerts.map((alert) => alert.toJSON());
  } catch (error) {
    console.error('Error fetching recent alerts:', error);
    return [];
  }
}

module.exports = router;
