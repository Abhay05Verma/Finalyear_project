const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Alert, AlertRule, SensorNode, Location, User } = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');

const ADMIN_ONLY_ALERT_PATTERN = 'sensor_health_%';

const applyAlertVisibilityFilter = (whereClause = {}, userRole = null) => {
  if (userRole === 'admin') {
    return whereClause;
  }

  if (!whereClause[Op.and]) {
    whereClause[Op.and] = [];
  }

  whereClause[Op.and].push({
    alert_type: {
      [Op.notLike]: ADMIN_ONLY_ALERT_PATTERN
    }
  });

  return whereClause;
};

const isAdminOnlyAlert = (alert) =>
  String(alert?.alert_type || '').startsWith('sensor_health_');

// Get all alerts with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      severity,
      is_acknowledged,
      node_id,
      location_id,
      start_date,
      end_date
    } = req.query;

    const whereClause = {};
    
    if (severity) whereClause.severity = severity;
    if (is_acknowledged !== undefined) whereClause.is_acknowledged = is_acknowledged === 'true';
    if (node_id) whereClause.node_id = node_id;
    if (location_id) whereClause.location_id = location_id;
    
    if (start_date || end_date) {
      whereClause.created_at = {};
      if (start_date) whereClause.created_at[Op.gte] = new Date(start_date);
      if (end_date) whereClause.created_at[Op.lte] = new Date(end_date);
    }

    applyAlertVisibilityFilter(whereClause, req.userRole);

    const alerts = await Alert.findAll({
      where: whereClause,
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name', 'node_id']
        },
        {
          model: Location,
          as: 'location',
          attributes: ['name']
        },
        {
          model: User,
          as: 'acknowledged_by_user',
          attributes: ['full_name']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const total = await Alert.count({ where: whereClause });

    res.json({
      success: true,
      data: alerts.map(alert => alert.toJSON()),
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerts'
    });
  }
});

// Get unacknowledged alerts
router.get('/unacknowledged', async (req, res) => {

  try {
    const { limit = 50, node_id, location_id } = req.query;
    const whereClause = applyAlertVisibilityFilter({ is_acknowledged: false }, null);

    if (node_id) whereClause.node_id = node_id;
    if (location_id) whereClause.location_id = location_id;

    const alerts = await Alert.findAll({
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
      order: [['created_at', 'DESC']],
      limit: parseInt(limit)
    });

    const count = await Alert.count({ where: whereClause });

    res.json({
      success: true,
      alerts: alerts.map(alert => alert.toJSON()),
      count
    });
  } catch (error) {
    console.error('Error fetching unacknowledged alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerts'
    });
  }
});

// Get specific alert
router.get('/:id(\\d+)', authMiddleware, async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id, {
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name', 'node_id']
        },
        {
          model: Location,
          as: 'location',
          attributes: ['name']
        },
        {
          model: User,
          as: 'acknowledged_by_user',
          attributes: ['full_name']
        }
      ]
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }

    if (req.userRole !== 'admin' && isAdminOnlyAlert(alert)) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }

    res.json({
      success: true,
      alert: alert.toJSON()
    });
  } catch (error) {
    console.error('Error fetching alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert'
    });
  }
});

// Acknowledge alert
router.post('/:id(\\d+)/acknowledge', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const alertService = require('../services/alertService');
    const alert = await alertService.acknowledgeAlert(req.params.id, req.userId);

    res.json({
      success: true,
      message: 'Alert acknowledged successfully',
      alert: alert.toJSON()
    });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    
    if (error.message === 'Alert not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    
    if (error.message === 'Alert already acknowledged') {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alert'
    });
  }
});

// Get alert statistics
router.get('/stats/summary', authMiddleware, async (req, res) => {
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
      default:
        timeAgo.setDate(timeAgo.getDate() - 1);
    }

    const { sequelize } = require('../models');
    const timeWindowWhere = applyAlertVisibilityFilter({
      created_at: {
        [Op.gte]: timeAgo
      }
    }, req.userRole);
    
    // Get severity distribution
    const severityStats = await Alert.findAll({
      where: timeWindowWhere,
      attributes: [
        'severity',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['severity'],
      raw: true
    });

    // Get unacknowledged count
    const unacknowledgedCount = await Alert.count({
      where: applyAlertVisibilityFilter({
        is_acknowledged: false,
        created_at: {
          [Op.gte]: timeAgo
        }
      }, req.userRole)
    });

    // Get alerts by node
    const nodeStats = await Alert.findAll({
      where: applyAlertVisibilityFilter({
        created_at: {
          [Op.gte]: timeAgo
        }
      }, req.userRole),
      attributes: [
        'node_id',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['node_id'],
      order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
      limit: 5,
      raw: true
    });

    // Get recent alert trend (last 6 hours by hour)
    const trendData = await Alert.findAll({
      where: applyAlertVisibilityFilter({
        created_at: {
          [Op.gte]: new Date(Date.now() - 6 * 60 * 60 * 1000)
        }
      }, req.userRole),
      attributes: [
        [sequelize.fn('DATE_FORMAT', sequelize.col('created_at'), '%Y-%m-%d %H:00:00'), 'hour'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: [sequelize.fn('DATE_FORMAT', sequelize.col('created_at'), '%Y-%m-%d %H:00:00')],
      order: [[sequelize.fn('DATE_FORMAT', sequelize.col('created_at'), '%Y-%m-%d %H:00:00'), 'ASC']],
      raw: true
    });

    res.json({
      success: true,
      statistics: {
        timeframe,
        total_alerts: severityStats.reduce((sum, stat) => sum + parseInt(stat.count), 0),
        unacknowledged: unacknowledgedCount,
        severity_distribution: severityStats,
        top_nodes: nodeStats,
        trend: trendData
      }
    });
  } catch (error) {
    console.error('Error fetching alert statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert statistics'
    });
  }
});

// Create new alert rule (admin only)
router.post('/rules', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const {
      name,
      description,
      parameter,
      operator,
      threshold_value,
      severity,
      duration_minutes,
      location_id,
      is_active = true
    } = req.body;

    // Validate required fields
    if (!name || !parameter || !operator || threshold_value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const rule = await AlertRule.create({
      name,
      description,
      parameter,
      operator,
      threshold_value: parseFloat(threshold_value),
      severity: severity || 'medium',
      duration_minutes: duration_minutes || 5,
      location_id: location_id || null,
      is_active,
      created_by: req.userId
    });

    res.json({
      success: true,
      message: 'Alert rule created successfully',
      rule: rule.toJSON()
    });
  } catch (error) {
    console.error('Error creating alert rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create alert rule'
    });
  }
});

// Get alert rules
router.get('/rules', authMiddleware, async (req, res) => {
  try {
    const { is_active, location_id } = req.query;
    
    const whereClause = {};
    if (is_active !== undefined) whereClause.is_active = is_active === 'true';
    if (location_id) whereClause.location_id = location_id;

    const rules = await AlertRule.findAll({
      where: whereClause,
      include: [
        {
          model: Location,
          as: 'location',
          attributes: ['name']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['full_name']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      rules: rules.map(rule => rule.toJSON())
    });
  } catch (error) {
    console.error('Error fetching alert rules:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert rules'
    });
  }
});

// Update alert rule
router.put('/rules/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const rule = await AlertRule.findByPk(req.params.id);
    
    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Alert rule not found'
      });
    }

    const updates = req.body;
    await rule.update(updates);

    res.json({
      success: true,
      message: 'Alert rule updated successfully',
      rule: rule.toJSON()
    });
  } catch (error) {
    console.error('Error updating alert rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update alert rule'
    });
  }
});

// Delete alert rule
router.delete('/rules/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const rule = await AlertRule.findByPk(req.params.id);
    
    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Alert rule not found'
      });
    }

    await rule.destroy();

    res.json({
      success: true,
      message: 'Alert rule deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting alert rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete alert rule'
    });
  }
});

// Bulk acknowledge alerts
router.post('/bulk-acknowledge', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { alert_ids } = req.body;
    
    if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Alert IDs array is required'
      });
    }

    const updated = await Alert.update({
      is_acknowledged: true,
      acknowledged_by: req.userId,
      acknowledged_at: new Date()
    }, {
      where: {
        id: { [Op.in]: alert_ids },
        is_acknowledged: false
      }
    });

    // Broadcast acknowledgment
    const websocketService = require('../services/websocketService');
    websocketService.io.emit('bulk-alerts-acknowledged', {
      alert_ids,
      acknowledged_by: req.userId,
      acknowledged_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `${updated[0]} alerts acknowledged successfully`
    });
  } catch (error) {
    console.error('Error bulk acknowledging alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alerts'
    });
  }
});

module.exports = router;
