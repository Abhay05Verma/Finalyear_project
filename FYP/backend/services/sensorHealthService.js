const cron = require('node-cron');
const { SensorNode, SensorData, Location } = require('../models');
const thingspeakConfig = require('../config/thingspeak');
const alertService = require('./alertService');

class SensorHealthService {
  constructor() {
    this.isRunning = false;
    this.defaultOfflineThresholdMinutes = Number(process.env.SENSOR_OFFLINE_THRESHOLD_MINUTES || 30);
    this.defaultBatteryThreshold = Number(process.env.SENSOR_LOW_BATTERY_THRESHOLD || 20);
  }

  getExpectedFields(sensorType) {
    const fieldsByType = {
      rainfall: ['rainfall'],
      soil_moisture: ['soil_moisture'],
      tilt: ['tilt_x', 'tilt_y'],
      vibration: ['vibration'],
      temperature: ['temperature'],
      multi: ['rainfall', 'soil_moisture', 'tilt_x', 'tilt_y', 'vibration', 'temperature', 'pressure', 'battery']
    };

    return fieldsByType[sensorType] || fieldsByType.multi;
  }

  getStaleThresholdMinutes() {
    const explicitThreshold = Number(process.env.SENSOR_STALE_DATA_THRESHOLD_MINUTES);
    if (Number.isFinite(explicitThreshold) && explicitThreshold > 0) {
      return explicitThreshold;
    }

    const fetchIntervalMs = Number(process.env.THINGSPEAK_FETCH_INTERVAL || thingspeakConfig.fetchInterval || 20000);
    const derivedMinutes = Math.ceil((fetchIntervalMs * 6) / 60000);
    return Math.max(5, derivedMinutes);
  }

  isPlaceholderConfig(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return !normalized || normalized.startsWith('YOUR_');
  }

  describeAge(dateValue) {
    if (!dateValue) return 'never';

    const diffMs = Date.now() - new Date(dateValue).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) {
      return 'unknown time ago';
    }

    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes < 1) return 'less than a minute ago';
    if (totalMinutes < 60) return `${totalMinutes} minute(s) ago`;

    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 24) return `${totalHours} hour(s) ago`;

    const totalDays = Math.floor(totalHours / 24);
    return `${totalDays} day(s) ago`;
  }

  buildIssue({ code, severity, message, observedValue = 0, thresholdValue = 0 }) {
    return {
      code,
      severity,
      message,
      observedValue,
      thresholdValue,
      alertType: `sensor_health_${code}`.slice(0, 50)
    };
  }

  async evaluateNode(node) {
    const latestData = await SensorData.findOne({
      where: { node_id: node.node_id },
      order: [['reading_timestamp', 'DESC']]
    });

    const issues = [];
    const expectedFields = this.getExpectedFields(node.sensor_type);
    const offlineThresholdMinutes = this.defaultOfflineThresholdMinutes;
    const staleThresholdMinutes = this.getStaleThresholdMinutes();
    const lowBatteryThreshold = this.defaultBatteryThreshold;
    const channelConfig = thingspeakConfig.channels?.[node.node_id];

    if (!channelConfig || this.isPlaceholderConfig(channelConfig.channelId) || this.isPlaceholderConfig(channelConfig.readKey)) {
      issues.push(this.buildIssue({
        code: 'missing_config',
        severity: 'medium',
        message: `Sensor node ${node.name} (${node.node_id}) has incomplete ThingSpeak configuration, so automatic readings may not arrive.`,
        observedValue: 0,
        thresholdValue: 1
      }));
    }

    if (node.status === 'maintenance') {
      issues.push(this.buildIssue({
        code: 'maintenance',
        severity: 'low',
        message: `Sensor node ${node.name} (${node.node_id}) is in maintenance mode.`,
        observedValue: 1,
        thresholdValue: 0
      }));
    }

    if (!node.last_seen) {
      issues.push(this.buildIssue({
        code: 'no_heartbeat',
        severity: 'critical',
        message: `Sensor node ${node.name} (${node.node_id}) has never reported a heartbeat.`,
        observedValue: 0,
        thresholdValue: offlineThresholdMinutes
      }));
    } else {
      const lastSeenAgeMinutes = (Date.now() - new Date(node.last_seen).getTime()) / 60000;
      if (lastSeenAgeMinutes > offlineThresholdMinutes || node.status === 'offline') {
        issues.push(this.buildIssue({
          code: 'offline',
          severity: 'critical',
          message: `Sensor node ${node.name} (${node.node_id}) appears offline. Last heartbeat was ${this.describeAge(node.last_seen)}.`,
          observedValue: Number(lastSeenAgeMinutes.toFixed(2)),
          thresholdValue: offlineThresholdMinutes
        }));
      }
    }

    if (!latestData) {
      issues.push(this.buildIssue({
        code: 'no_data',
        severity: 'critical',
        message: `Sensor node ${node.name} (${node.node_id}) has no sensor readings stored in the database.`,
        observedValue: 0,
        thresholdValue: 1
      }));
    } else {
      const readingAgeMinutes = (Date.now() - new Date(latestData.reading_timestamp).getTime()) / 60000;
      if (readingAgeMinutes > staleThresholdMinutes) {
        issues.push(this.buildIssue({
          code: 'stale_data',
          severity: 'high',
          message: `Sensor node ${node.name} (${node.node_id}) has stale sensor data. Latest reading was ${this.describeAge(latestData.reading_timestamp)}.`,
          observedValue: Number(readingAgeMinutes.toFixed(2)),
          thresholdValue: staleThresholdMinutes
        }));
      }

      const missingFields = expectedFields.filter((field) => latestData[field] === null || latestData[field] === undefined);
      if (missingFields.length > 0) {
        issues.push(this.buildIssue({
          code: 'missing_fields',
          severity: 'high',
          message: `Sensor node ${node.name} (${node.node_id}) is missing required sensor values: ${missingFields.join(', ')}.`,
          observedValue: missingFields.length,
          thresholdValue: 0
        }));
      }
    }

    const batteryLevel = Number(node.battery_level ?? latestData?.battery);
    if (Number.isFinite(batteryLevel) && batteryLevel < lowBatteryThreshold) {
      issues.push(this.buildIssue({
        code: 'low_battery',
        severity: batteryLevel < 10 ? 'high' : 'medium',
        message: `Sensor node ${node.name} (${node.node_id}) has low battery (${batteryLevel.toFixed(2)}%).`,
        observedValue: Number(batteryLevel.toFixed(2)),
        thresholdValue: lowBatteryThreshold
      }));
    }

    return {
      node_id: node.node_id,
      name: node.name,
      location_id: node.location_id,
      location_name: node.location?.name || null,
      status: issues.length === 0 ? 'healthy' : 'unhealthy',
      sensor_type: node.sensor_type,
      last_seen: node.last_seen,
      latest_reading_at: latestData?.reading_timestamp || null,
      issues
    };
  }

  async notifyAdminsForIssue(nodeReport, issue) {
    const cooldownMinutes = Number(process.env.SENSOR_HEALTH_ALERT_COOLDOWN_MINUTES || 30);

    return alertService.createSensorHealthAlert({
      nodeId: nodeReport.node_id,
      locationId: nodeReport.location_id,
      severity: issue.severity,
      alertType: issue.alertType,
      message: issue.message,
      observedValue: issue.observedValue,
      thresholdValue: issue.thresholdValue,
      cooldownMinutes
    });
  }

  async scanAllSensors({ notifyAdmins = false } = {}) {
    const nodes = await SensorNode.findAll({
      where: { is_active: true },
      include: [
        {
          model: Location,
          as: 'location',
          attributes: ['id', 'name']
        }
      ],
      order: [['name', 'ASC']]
    });

    const reports = [];
    for (const node of nodes) {
      reports.push(await this.evaluateNode(node));
    }

    const unhealthyReports = reports.filter((report) => report.issues.length > 0);
    const createdAlerts = [];

    if (notifyAdmins) {
      for (const report of unhealthyReports) {
        for (const issue of report.issues) {
          const alert = await this.notifyAdminsForIssue(report, issue);
          if (alert) createdAlerts.push(alert);
        }
      }
    }

    return {
      checked_at: new Date().toISOString(),
      total_nodes: reports.length,
      healthy_nodes: reports.length - unhealthyReports.length,
      unhealthy_nodes: unhealthyReports.length,
      reports,
      created_alerts: createdAlerts.length
    };
  }

  startMonitoring() {
    if (this.isRunning) return;

    cron.schedule('*/10 * * * *', async () => {
      try {
        await this.scanAllSensors({ notifyAdmins: true });
      } catch (error) {
        console.error('Sensor health monitoring failed:', error);
      }
    });

    this.isRunning = true;
    console.log('Sensor health monitoring started');
  }
}

module.exports = new SensorHealthService();
