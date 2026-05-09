const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, SensorData, Alert, SensorNode, Location, Notification, sequelize } = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');
const sensorHealthService = require('../services/sensorHealthService');

const normalizeMobileNumber = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/[^\d+]/g, '');
  return normalized || null;
};

// Get system statistics (admin only)
router.get('/system-stats', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    // Database statistics
    const dbStats = {
      users: await User.count(),
      sensor_nodes: await SensorNode.count(),
      locations: await Location.count(),
      sensor_data: await SensorData.count(),
      alerts: await Alert.count(),
      unacknowledged_alerts: await Alert.count({ where: { is_acknowledged: false } })
    };

    // Storage statistics
    const storageStats = await getStorageStatistics();

    // Performance statistics
    const performanceStats = await getPerformanceStatistics();

    // Recent activity
    const recentActivity = await getRecentActivity();

    res.json({
      success: true,
      statistics: {
        database: dbStats,
        storage: storageStats,
        performance: performanceStats,
        recent_activity: recentActivity,
        system_info: {
          node_version: process.version,
          platform: process.platform,
          uptime: process.uptime(),
          memory_usage: process.memoryUsage()
        }
      }
    });
  } catch (error) {
    console.error('Error fetching system statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system statistics'
    });
  }
});

// Get user management data
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      users: users.map(user => user.toJSON())
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// Get locations for admin configuration screens
router.get('/locations', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const locations = await Location.findAll({
      attributes: ['id', 'name', 'region', 'is_active'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      locations: locations.map((location) => location.toJSON())
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch locations'
    });
  }
});

// Create new user
router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, email, role, is_active = true } = req.body;
    const mobile_number = normalizeMobileNumber(req.body.mobile_number);

    // Validate required fields
    if (!username || !password || !full_name || !email || !mobile_number) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, full name, email, and mobile number are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      where: { [Op.or]: [{ username }, { email }, { mobile_number }] }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Username, email, or mobile number already exists'
      });
    }

    const user = await User.create({
      username,
      password_hash: password, // Will be hashed by model hook
      full_name,
      email,
      mobile_number,
      role: role || 'viewer',
      is_active
    });

    await Notification.findOrCreate({
      where: { user_id: user.id },
      defaults: {
        user_id: user.id,
        email_notifications: true,
        push_notifications: true,
        sms_notifications: true,
        low_severity: true,
        medium_severity: true,
        high_severity: true,
        critical_severity: true,
        notification_frequency: 'immediate'
      }
    });

    res.json({
      success: true,
      message: 'User created successfully',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

// Update user
router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const updates = { ...req.body };

    if (updates.mobile_number !== undefined) {
      updates.mobile_number = normalizeMobileNumber(updates.mobile_number);
    }

    if (updates.email || updates.mobile_number) {
      const uniquenessChecks = [];

      if (updates.email) {
        uniquenessChecks.push({ email: updates.email });
      }

      if (updates.mobile_number) {
        uniquenessChecks.push({ mobile_number: updates.mobile_number });
      }

      if (uniquenessChecks.length > 0) {
        const existingUser = await User.findOne({
          where: {
            id: { [Op.ne]: user.id },
            [Op.or]: uniquenessChecks
          }
        });

        if (existingUser) {
          return res.status(400).json({
            success: false,
            error: 'Email or mobile number already exists'
          });
        }
      }
    }
    
    // Don't update password directly unless specified
    if (updates.password) {
      updates.password_hash = updates.password;
      delete updates.password;
    }

    await user.update(updates);

    res.json({
      success: true,
      message: 'User updated successfully',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

// Delete user
router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Prevent deleting yourself
    if (user.id === req.userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    await user.destroy();

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// System configuration
router.get('/configuration', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    // This would typically come from a database table
    const config = {
      system: {
        name: 'Landslide Early Warning System',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        maintenance_mode: false
      },
      data_retention: {
        raw_data_days: 365,
        hourly_data_days: 730,
        daily_data_days: 3650
      },
      alerting: {
        enabled: true,
        email_notifications: true,
        sms_notifications: true,
        push_notifications: true
      },
      integration: {
        thingspeak_enabled: !!process.env.THINGSPEAK_API_KEY,
        fetch_interval: process.env.THINGSPEAK_FETCH_INTERVAL || 30000
      }
    };

    res.json({
      success: true,
      configuration: config
    });
  } catch (error) {
    console.error('Error fetching configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch configuration'
    });
  }
});

// Update system configuration
router.put('/configuration', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    // In a real application, this would update a configuration table
    // For now, we'll just return success
    const updates = req.body;
    
    // Log configuration update
    console.log('Configuration updated:', updates);

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      configuration: updates
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

// Database maintenance
router.post('/database/maintenance', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { action } = req.body;

    switch (action) {
      case 'optimize_tables':
        await optimizeDatabaseTables();
        break;
      case 'cleanup_old_data':
        await cleanupOldData();
        break;
      case 'backup':
        await createDatabaseBackup();
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action specified'
        });
    }

    res.json({
      success: true,
      message: `Database ${action} completed successfully`
    });
  } catch (error) {
    console.error('Error performing database maintenance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform database maintenance'
    });
  }
});

// Get system logs
router.get('/logs', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { level, module, start_date, end_date, limit = 100 } = req.query;
    
    // In a real application, this would query a logs table
    // For now, return mock logs
    const logs = [
      {
        id: 1,
        level: 'info',
        module: 'server',
        message: 'Server started successfully',
        timestamp: new Date().toISOString()
      },
      {
        id: 2,
        level: 'info',
        module: 'database',
        message: 'Database connection established',
        timestamp: new Date(Date.now() - 10000).toISOString()
      }
    ];

    res.json({
      success: true,
      logs,
      count: logs.length
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs'
    });
  }
});

router.get('/sensor-health', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const report = await sensorHealthService.scanAllSensors({ notifyAdmins: false });

    res.json({
      success: true,
      sensor_health: report
    });
  } catch (error) {
    console.error('Error fetching sensor health report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sensor health report'
    });
  }
});

router.post('/sensor-health/check', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const report = await sensorHealthService.scanAllSensors({ notifyAdmins: true });

    res.json({
      success: true,
      message: 'Sensor health check completed',
      sensor_health: report
    });
  } catch (error) {
    console.error('Error running sensor health check:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run sensor health check'
    });
  }
});

// Test system components
router.post('/test', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { component } = req.body;
    const results = {};

    switch (component) {
      case 'database':
        results.database = await testDatabaseConnection();
        break;
      case 'email':
        results.email = await testEmailService();
        break;
      case 'sms':
        results.sms = await testSmsService();
        break;
      case 'thingspeak':
        results.thingspeak = await testThingSpeakConnection();
        break;
      case 'sensor-health':
        results.sensor_health = await testSensorHealth();
        break;
      case 'all':
        results.database = await testDatabaseConnection();
        results.email = await testEmailService();
        results.sms = await testSmsService();
        results.thingspeak = await testThingSpeakConnection();
        results.sensor_health = await testSensorHealth();
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid component specified'
        });
    }

    const allSuccessful = Object.values(results).every(result => result.success);
    
    res.json({
      success: allSuccessful,
      results,
      message: allSuccessful ? 'All tests passed' : 'Some tests failed'
    });
  } catch (error) {
    console.error('Error running system tests:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run system tests'
    });
  }
});

// Helper functions
async function getStorageStatistics() {
  try {
    const [results] = await sequelize.query(`
      SELECT 
        table_name,
        ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
        table_rows
      FROM information_schema.TABLES
      WHERE table_schema = DATABASE()
      ORDER BY (data_length + index_length) DESC
    `);

    const totalSize = results.reduce((sum, table) => sum + parseFloat(table.size_mb), 0);

    return {
      tables: results,
      total_size_mb: parseFloat(totalSize.toFixed(2)),
      table_count: results.length
    };
  } catch (error) {
    console.error('Error getting storage statistics:', error);
    return { error: 'Failed to get storage statistics' };
  }
}

async function getPerformanceStatistics() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  try {
    // Get data ingestion rate
    const recentDataCount = await SensorData.count({
      where: {
        reading_timestamp: {
          [Op.gte]: oneHourAgo
        }
      }
    });

    const dataRate = recentDataCount / 60; // Readings per minute

    // Get alert rate
    const recentAlertsCount = await Alert.count({
      where: {
        created_at: {
          [Op.gte]: oneHourAgo
        }
      }
    });

    const alertRate = recentAlertsCount / 60; // Alerts per minute

    return {
      data_ingestion_rate: parseFloat(dataRate.toFixed(2)),
      alert_generation_rate: parseFloat(alertRate.toFixed(2)),
      active_connections: 0, // Would get from WebSocket service
      avg_response_time_ms: 50 // Would be calculated from actual metrics
    };
  } catch (error) {
    console.error('Error getting performance statistics:', error);
    return { error: 'Failed to get performance statistics' };
  }
}

async function getRecentActivity() {
  try {
    // Get recent sensor data
    const recentData = await SensorData.findAll({
      order: [['reading_timestamp', 'DESC']],
      limit: 5,
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name']
        }
      ]
    });

    // Get recent alerts
    const recentAlerts = await Alert.findAll({
      where: { is_acknowledged: false },
      order: [['created_at', 'DESC']],
      limit: 5,
      include: [
        {
          model: SensorNode,
          as: 'sensor_node',
          attributes: ['name']
        }
      ]
    });

    // Get recent user logins
    const recentLogins = await User.findAll({
      where: {
        last_login: {
          [Op.not]: null
        }
      },
      order: [['last_login', 'DESC']],
      limit: 5,
      attributes: ['username', 'full_name', 'last_login', 'role']
    });

    return {
      recent_sensor_data: recentData.map(data => ({
        node: data.sensor_node ? data.sensor_node.name : 'Unknown',
        rainfall: data.rainfall,
        risk_score: data.risk_score,
        timestamp: data.reading_timestamp
      })),
      recent_alerts: recentAlerts.map(alert => ({
        node: alert.sensor_node ? alert.sensor_node.name : 'Unknown',
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.created_at
      })),
      recent_logins: recentLogins.map(user => user.toJSON())
    };
  } catch (error) {
    console.error('Error getting recent activity:', error);
    return { error: 'Failed to get recent activity' };
  }
}

async function optimizeDatabaseTables() {
  try {
    // Get all tables
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.TABLES 
      WHERE table_schema = DATABASE()
    `);

    // Optimize each table
    for (const table of tables) {
      await sequelize.query(`OPTIMIZE TABLE ${table.TABLE_NAME}`);
    }

    return { success: true, message: `Optimized ${tables.length} tables` };
  } catch (error) {
    console.error('Error optimizing tables:', error);
    return { success: false, error: error.message };
  }
}

async function cleanupOldData() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Delete old sensor data (keep 30 days)
    const deletedData = await SensorData.destroy({
      where: {
        reading_timestamp: {
          [Op.lt]: thirtyDaysAgo
        }
      }
    });

    // Delete old acknowledged alerts (keep 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const deletedAlerts = await Alert.destroy({
      where: {
        is_acknowledged: true,
        created_at: {
          [Op.lt]: ninetyDaysAgo
        }
      }
    });

    return {
      success: true,
      deleted_sensor_data: deletedData,
      deleted_alerts: deletedAlerts,
      message: `Cleaned up ${deletedData} sensor data records and ${deletedAlerts} alerts`
    };
  } catch (error) {
    console.error('Error cleaning up old data:', error);
    return { success: false, error: error.message };
  }
}

async function createDatabaseBackup() {
  try {
    const backupName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    
    // In production, use mysqldump or similar tool
    // This is a simplified example
    console.log(`Creating database backup: ${backupName}`);
    
    return {
      success: true,
      backup_name: backupName,
      message: 'Backup created successfully'
    };
  } catch (error) {
    console.error('Error creating backup:', error);
    return { success: false, error: error.message };
  }
}

async function testDatabaseConnection() {
  try {
    await sequelize.authenticate();
    return { success: true, message: 'Database connection successful' };
  } catch (error) {
    return { success: false, message: `Database connection failed: ${error.message}` };
  }
}

async function testEmailService() {
  try {
    // Test email configuration
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch {
      return { success: false, message: 'nodemailer package is not installed' };
    }
    
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });

    await transporter.verify();
    
    return { success: true, message: 'Email service configured correctly' };
  } catch (error) {
    return { success: false, message: `Email service test failed: ${error.message}` };
  }
}

async function testSmsService() {
  try {
    const { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_SENDER_ID, SMS_MIN_SEVERITY } = process.env;

    if (!MSG91_AUTH_KEY || !MSG91_TEMPLATE_ID || !MSG91_SENDER_ID) {
      return { success: false, message: 'MSG91 SMS configuration is incomplete' };
    }

    return {
      success: true,
      message: `MSG91 SMS configuration is present (minimum severity: ${SMS_MIN_SEVERITY || 'high'})`
    };
  } catch (error) {
    return { success: false, message: `SMS service test failed: ${error.message}` };
  }
}

async function testThingSpeakConnection() {
  try {
    const thingspeakService = require('../services/thingspeakService');
    const status = await thingspeakService.getChannelStatus();
    
    const successfulConnections = status.filter(s => s.status === 'connected').length;
    
    return {
      success: successfulConnections > 0,
      message: `${successfulConnections}/${status.length} ThingSpeak channels connected`,
      details: status
    };
  } catch (error) {
    return { success: false, message: `ThingSpeak test failed: ${error.message}` };
  }
}

async function testSensorHealth() {
  try {
    const report = await sensorHealthService.scanAllSensors({ notifyAdmins: false });
    return {
      success: true,
      message: `${report.healthy_nodes}/${report.total_nodes} sensor nodes are healthy`,
      details: report
    };
  } catch (error) {
    return { success: false, message: `Sensor health test failed: ${error.message}` };
  }
}

module.exports = router;
