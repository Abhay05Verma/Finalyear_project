const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { SensorNode, Location, SensorData, Alert } = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Get all sensor nodes (public read-only)
router.get('/', async (req, res) => {
  try {
    const whereClause = { is_active: true };
    if (req.query.location_id) {
      whereClause.location_id = req.query.location_id;
    }

    const nodes = await SensorNode.findAll({
      where: whereClause,
      include: [
        {
          model: Location,
          as: 'location',
          attributes: ['id', 'name', 'risk_level', 'region']
        }
      ],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      nodes: nodes.map((node) => {
        const json = node.toJSON();
        return {
          ...json,
          location_name: json.location ? json.location.name : null,
          location_region: json.location ? json.location.region : null,
          location_risk_level: json.location ? json.location.risk_level : null
        };
      })
    });
  } catch (error) {
    console.error('Error fetching sensor nodes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sensor nodes'
    });
  }
});

// Get specific sensor node
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const node = await SensorNode.findOne({
      where: { node_id: req.params.id },
      include: [
        {
          model: Location,
          as: 'location',
          attributes: ['name', 'risk_level', 'latitude', 'longitude']
        }
      ]
    });

    if (!node) {
      return res.status(404).json({
        success: false,
        error: 'Sensor node not found'
      });
    }

    // Get latest sensor data for this node
    const latestData = await SensorData.findOne({
      where: { node_id: req.params.id },
      order: [['reading_timestamp', 'DESC']]
    });

    // Get recent alerts for this node
    const recentAlerts = await Alert.findAll({
      where: { node_id: req.params.id },
      order: [['created_at', 'DESC']],
      limit: 10
    });

    res.json({
      success: true,
      node: node.toJSON(),
      latest_data: latestData ? latestData.toJSON() : null,
      recent_alerts: recentAlerts.map(alert => alert.toJSON())
    });
  } catch (error) {
    console.error('Error fetching sensor node:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sensor node'
    });
  }
});

// Create new sensor node (admin only)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const {
      node_id,
      name,
      location_id,
      sensor_type,
      status,
      battery_level,
      firmware_version,
      hardware_version,
      installation_date
    } = req.body;

    // Validate required fields
    if (!node_id || !name || !location_id) {
      return res.status(400).json({
        success: false,
        error: 'Node ID, name, and location are required'
      });
    }

    // Check if node ID already exists
    const existingNode = await SensorNode.findOne({ where: { node_id } });
    if (existingNode) {
      return res.status(400).json({
        success: false,
        error: 'Node ID already exists'
      });
    }

    const node = await SensorNode.create({
      node_id,
      name,
      location_id,
      sensor_type: sensor_type || 'multi',
      status: status || 'offline',
      battery_level: battery_level || 100.00,
      firmware_version,
      hardware_version,
      installation_date: installation_date ? new Date(installation_date) : null,
      is_active: true
    });

    res.json({
      success: true,
      message: 'Sensor node created successfully',
      node: node.toJSON()
    });
  } catch (error) {
    console.error('Error creating sensor node:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create sensor node'
    });
  }
});

// Update sensor node
router.put('/:id', authMiddleware, requireRole('admin', 'operator'), async (req, res) => {
  try {
    const node = await SensorNode.findOne({ where: { node_id: req.params.id } });
    
    if (!node) {
      return res.status(404).json({
        success: false,
        error: 'Sensor node not found'
      });
    }

    const updates = req.body;
    
    // Prevent updating node_id
    if (updates.node_id) {
      delete updates.node_id;
    }

    await node.update(updates);

    // Broadcast node update via WebSocket
    const websocketService = require('../services/websocketService');
    websocketService.broadcastNodeStatusUpdate(node.toJSON());

    res.json({
      success: true,
      message: 'Sensor node updated successfully',
      node: node.toJSON()
    });
  } catch (error) {
    console.error('Error updating sensor node:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update sensor node'
    });
  }
});

// Delete sensor node (admin only)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const node = await SensorNode.findOne({ where: { node_id: req.params.id } });
    
    if (!node) {
      return res.status(404).json({
        success: false,
        error: 'Sensor node not found'
      });
    }

    await node.destroy();

    res.json({
      success: true,
      message: 'Sensor node deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting sensor node:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete sensor node'
    });
  }
});

// Get node status summary
router.get('/status/summary', authMiddleware, async (req, res) => {
  try {
    const { sequelize } = require('../models');
    
    const statusSummary = await SensorNode.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Calculate battery statistics
    const batteryStats = await SensorNode.findAll({
      attributes: [
        [sequelize.fn('AVG', sequelize.col('battery_level')), 'avg_battery'],
        [sequelize.fn('MIN', sequelize.col('battery_level')), 'min_battery'],
        [sequelize.fn('MAX', sequelize.col('battery_level')), 'max_battery']
      ],
      where: { status: 'online' },
      raw: true
    });

    // Get nodes with low battery (< 20%)
    const lowBatteryNodes = await SensorNode.findAll({
      where: {
        battery_level: {
          [Op.lt]: 20
        }
      },
      attributes: ['node_id', 'name', 'battery_level'],
      order: [['battery_level', 'ASC']],
      limit: 10
    });

    // Get offline nodes (last seen > 30 minutes ago)
    const offlineThreshold = new Date(Date.now() - 30 * 60 * 1000);
    const offlineNodes = await SensorNode.findAll({
      where: {
        status: 'online',
        last_seen: {
          [Op.lt]: offlineThreshold
        }
      },
      attributes: ['node_id', 'name', 'last_seen'],
      order: [['last_seen', 'ASC']],
      limit: 10
    });

    res.json({
      success: true,
      summary: {
        status: statusSummary.reduce((acc, stat) => {
          acc[stat.status] = parseInt(stat.count);
          return acc;
        }, { online: 0, offline: 0, maintenance: 0 }),
        battery: batteryStats[0] || {},
        low_battery_nodes: lowBatteryNodes.map(node => node.toJSON()),
        potentially_offline_nodes: offlineNodes.map(node => node.toJSON())
      }
    });
  } catch (error) {
    console.error('Error fetching node status summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch node status'
    });
  }
});

// Get node health metrics
router.get('/:id/health', authMiddleware, async (req, res) => {
  try {
    const node = await SensorNode.findOne({ where: { node_id: req.params.id } });
    
    if (!node) {
      return res.status(404).json({
        success: false,
        error: 'Sensor node not found'
      });
    }

    // Calculate health metrics
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get recent data count
    const recentDataCount = await SensorData.count({
      where: {
        node_id: req.params.id,
        reading_timestamp: {
          [Op.gte]: oneHourAgo
        }
      }
    });

    // Get data frequency (should be ~120 readings per hour at 30-second intervals)
    const dataFrequency = recentDataCount / 60; // Readings per minute

    // Calculate uptime based on last_seen
    let uptimePercentage = 0;
    if (node.last_seen) {
      const timeSinceLastSeen = now.getTime() - new Date(node.last_seen).getTime();
      uptimePercentage = Math.max(0, 100 - (timeSinceLastSeen / (30 * 60 * 1000)) * 100); // 30-minute window
    }

    // Get recent alerts
    const recentAlerts = await Alert.count({
      where: {
        node_id: req.params.id,
        created_at: {
          [Op.gte]: oneDayAgo
        }
      }
    });

    // Calculate health score
    let healthScore = 100;
    
    // Deduct for low battery
    if (node.battery_level < 20) healthScore -= 30;
    else if (node.battery_level < 50) healthScore -= 10;
    
    // Deduct for low data frequency
    if (dataFrequency < 1) healthScore -= 40; // Less than 1 reading per minute
    else if (dataFrequency < 1.5) healthScore -= 20; // Less than 1.5 readings per minute
    
    // Deduct for recent alerts
    healthScore -= Math.min(20, recentAlerts * 5);
    
    // Deduct for offline status
    if (node.status !== 'online') healthScore -= 50;
    
    healthScore = Math.max(0, Math.min(100, healthScore));

    res.json({
      success: true,
      health_metrics: {
        node_id: node.node_id,
        name: node.name,
        status: node.status,
        battery_level: node.battery_level,
        last_seen: node.last_seen,
        data_frequency: parseFloat(dataFrequency.toFixed(2)),
        uptime_percentage: parseFloat(uptimePercentage.toFixed(1)),
        recent_alerts: recentAlerts,
        health_score: parseFloat(healthScore.toFixed(1)),
        health_level: getHealthLevel(healthScore),
        recommendations: getHealthRecommendations(healthScore, node)
      }
    });
  } catch (error) {
    console.error('Error fetching node health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch node health'
    });
  }
});

// Helper function to get health level
function getHealthLevel(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'critical';
}

// Helper function to get health recommendations
function getHealthRecommendations(score, node) {
  const recommendations = [];
  
  if (node.battery_level < 20) {
    recommendations.push('Battery level critically low. Replace battery immediately.');
  } else if (node.battery_level < 50) {
    recommendations.push('Battery level low. Consider replacing battery soon.');
  }
  
  if (node.status !== 'online') {
    recommendations.push('Node is offline. Check power and network connection.');
  }
  
  if (score < 40) {
    recommendations.push('Node health is poor. Perform maintenance check.');
  }
  
  return recommendations;
}

// Simulate node restart (admin only)
router.post('/:id/restart', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const node = await SensorNode.findOne({ where: { node_id: req.params.id } });
    
    if (!node) {
      return res.status(404).json({
        success: false,
        error: 'Sensor node not found'
      });
    }

    // Simulate restart by updating status
    await node.update({
      status: 'maintenance',
      last_seen: new Date()
    });

    // Simulate delay for restart
    setTimeout(async () => {
      await node.update({ status: 'online' });
      
      // Broadcast update
      const websocketService = require('../services/websocketService');
      websocketService.broadcastNodeStatusUpdate(node.toJSON());
    }, 5000);

    res.json({
      success: true,
      message: 'Node restart initiated. Status will update in 5 seconds.'
    });
  } catch (error) {
    console.error('Error restarting node:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restart node'
    });
  }
});

module.exports = router;
