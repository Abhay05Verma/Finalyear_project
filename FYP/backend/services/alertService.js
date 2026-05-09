
const cron = require('node-cron');
const { Op, sequelize } = require('sequelize');
const { Alert, AlertRule, SensorData, SensorNode, Notification, User } = require('../models');
const websocketService = require('./websocketService');
const thingspeakConfig = require('../config/thingspeak');
const smsService = require('./smsService');

class AlertService {
  constructor() {
    this.isRunning = false;
  }

  isAdminOnlyAlert(alert) {
    return String(alert?.alert_type || '').startsWith('sensor_health_');
  }

  buildEmailRecipientOptions(alert, options = {}) {
    if (Array.isArray(options.roles) && options.roles.length > 0) {
      return options;
    }

    if (this.isAdminOnlyAlert(alert)) {
      return {
        ...options,
        roles: ['admin']
      };
    }

    return {
      ...options,
      excludeRoles: ['visitor']
    };
  }

  getParameterValue(record, parameter) {
    switch (parameter) {
      case 'rainfall': return record.rainfall;
      case 'soil_moisture': return record.soil_moisture;
      case 'tilt':
        return Math.max(
          Math.abs(record.tilt_x || 0),
          Math.abs(record.tilt_y || 0)
        );
      case 'vibration': return record.vibration;
      case 'temperature': return record.temperature;
      case 'risk_score': return record.risk_score;
      case 'battery': return record.battery;
      default: return null;
    }
  }

  compareValues(value, operator, threshold) {
    const numericValue = Number(value);
    const numericThreshold = Number(threshold);
    if (!Number.isFinite(numericValue) || !Number.isFinite(numericThreshold)) return false;

    switch (operator) {
      case '>': return numericValue > numericThreshold;
      case '>=': return numericValue >= numericThreshold;
      case '<': return numericValue < numericThreshold;
      case '<=': return numericValue <= numericThreshold;
      case '=': return numericValue === numericThreshold;
      case '!=': return numericValue !== numericThreshold;
      default: return false;
    }
  }

  async meetsDurationRequirement(rule, sensorData) {
    const durationMinutes = Number(rule.duration_minutes || 0);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return true;
    }

    const readingTime = sensorData.reading_timestamp
      ? new Date(sensorData.reading_timestamp)
      : new Date();
    const windowStart = new Date(readingTime.getTime() - durationMinutes * 60 * 1000);

    const attributes = ['reading_timestamp'];
    if (rule.parameter === 'tilt') {
      attributes.push('tilt_x', 'tilt_y');
    } else {
      attributes.push(rule.parameter);
    }

    const readings = await SensorData.findAll({
      where: {
        node_id: sensorData.node_id,
        location_id: sensorData.location_id,
        reading_timestamp: {
          [Op.between]: [windowStart, readingTime]
        }
      },
      attributes,
      order: [['reading_timestamp', 'ASC']],
      raw: true
    });

    if (readings.length === 0) return false;

    const intervalMs = Number(process.env.THINGSPEAK_FETCH_INTERVAL) || 30000;
    const coverageGraceMs = Math.max(60000, Math.floor(intervalMs * 1.5));
    const earliestTs = new Date(readings[0].reading_timestamp).getTime();
    if (earliestTs > (windowStart.getTime() + coverageGraceMs)) {
      return false;
    }

    return readings.every((reading) => {
      const value = this.getParameterValue(reading, rule.parameter);
      if (value === null || value === undefined) return false;
      return this.compareValues(value, rule.operator, rule.threshold_value);
    });
  }

  // ================================
  // CHECK FOR ALERTS
  // ================================
  async checkForAlerts(sensorData) {
    try {
      // 🚨 CRITICAL GUARD
      if (!sensorData.location_id) {
        console.warn(
          `⚠️ Alert check skipped: location_id is NULL for node ${sensorData.node_id}`
        );
        return [];
      }

      const alertRules = await AlertRule.findAll({
        where: {
          is_active: true,
          [Op.or]: [
            { location_id: null }, // Global rules
            { location_id: sensorData.location_id } // Location-specific rules
          ]
        }
      });

      const createdAlerts = [];

      for (const rule of alertRules) {
        const shouldCreateAlert = await this.evaluateRule(rule, sensorData);
        if (shouldCreateAlert) {
          const alert = await this.createAlert(rule, sensorData);
          if (alert) createdAlerts.push(alert);
        }
      }

      if (createdAlerts.length > 0) {
        websocketService.broadcastNewAlerts(createdAlerts);
      }

      return createdAlerts;
    } catch (error) {
      console.error('Error checking for alerts:', error);
      return [];
    }
  }

  // ================================
  // EVALUATE RULE
  // ================================
  async evaluateRule(rule, sensorData) {
    try {
      const value = this.getParameterValue(sensorData, rule.parameter);

      if (value === null || value === undefined) return false;
      if (!this.compareValues(value, rule.operator, rule.threshold_value)) return false;

      return await this.meetsDurationRequirement(rule, sensorData);
    } catch (error) {
      console.error('Error evaluating rule:', error);
      return false;
    }
  }

  // ================================
  // CREATE ALERT
  // ================================
  async createAlert(rule, sensorData) {
    try {
      if (!sensorData.location_id) return null;

      let parameterValue = 0;

      switch (rule.parameter) {
        case 'rainfall': parameterValue = sensorData.rainfall; break;
        case 'soil_moisture': parameterValue = sensorData.soil_moisture; break;
        case 'tilt':
          parameterValue = Math.max(
            Math.abs(sensorData.tilt_x || 0),
            Math.abs(sensorData.tilt_y || 0)
          );
          break;
        case 'vibration': parameterValue = sensorData.vibration; break;
        case 'temperature': parameterValue = sensorData.temperature; break;
        case 'risk_score': parameterValue = sensorData.risk_score; break;
        case 'battery': parameterValue = sensorData.battery; break;
      }

      const shouldSkip = await this.hasRecentAlert({
        alertRuleId: rule.id,
        nodeId: sensorData.node_id,
        locationId: sensorData.location_id,
        alertType: rule.parameter,
        cooldownMinutes: this.getThresholdAlertCooldownMinutes(rule)
      });

      if (shouldSkip) {
        return null;
      }

      const alert = await Alert.create({
        alert_rule_id: rule.id,
        node_id: sensorData.node_id,
        location_id: sensorData.location_id,
        alert_type: rule.parameter,
        message: `${rule.parameter} ${rule.operator} ${rule.threshold_value} (Current: ${parameterValue.toFixed(2)})`,
        severity: rule.severity,
        parameter_value: parameterValue,
        parameter_threshold: rule.threshold_value,
        is_acknowledged: false
      });

      console.log(`🚨 Alert created: ${alert.message}`);
      await this.dispatchAlertNotifications(alert);
      return alert;
    } catch (error) {
      console.error('Error creating alert:', error);
      return null;
    }
  }

  // ================================
  // ACKNOWLEDGE ALERT
  // ================================
  async acknowledgeAlert(alertId, userId) {
    const alert = await Alert.findByPk(alertId);
    if (!alert) throw new Error('Alert not found');
    if (alert.is_acknowledged) throw new Error('Already acknowledged');

    alert.is_acknowledged = true;
    alert.acknowledged_by = userId;
    alert.acknowledged_at = new Date();
    await alert.save();

    websocketService.io.emit('alert-acknowledged', {
      alert_id: alertId,
      acknowledged_by: userId,
      acknowledged_at: alert.acknowledged_at
    });

    return alert;
  }

  // ================================
  // START CRON MONITORING
  // ================================
  startAlertMonitoring() {
    if (this.isRunning) return;

    cron.schedule('*/5 * * * *', () => this.checkUnresolvedAlerts());
    cron.schedule('*/10 * * * *', () => this.checkOfflineNodes());

    this.isRunning = true;
    console.log('🚨 Alert monitoring started');
  }

  // ================================
  // ESCALATE UNRESOLVED ALERTS
  // ================================
  async checkUnresolvedAlerts() {
    try {
      const unresolved = await Alert.findAll({
        where: {
          is_acknowledged: false,
          created_at: {
            [Op.lt]: new Date(Date.now() - 30 * 60000)
          }
        }
      });

      for (const alert of unresolved) {
        if (alert.severity !== 'critical') {
          alert.severity = this.escalateSeverity(alert.severity);
          alert.message = `ESCALATED: ${alert.message}`;
          await alert.save();
          websocketService.broadcastNewAlerts([alert]);
        }
      }
    } catch (error) {
      console.error('Error escalating alerts:', error);
    }
  }

  // ================================
  // OFFLINE NODE CHECK
  // ================================
  async checkOfflineNodes() {
    try {
      const threshold = new Date(Date.now() - 30 * 60000);

      const nodes = await SensorNode.findAll({
        where: {
          status: 'online',
          last_seen: { [Op.lt]: threshold }
        }
      });

      for (const node of nodes) {
        node.status = 'offline';
        await node.save();

        const alert = await Alert.create({
          node_id: node.node_id,
          location_id: node.location_id,
          alert_type: 'node_status',
          message: `Node ${node.name} is offline`,
          severity: 'medium',
          parameter_value: 0,
          parameter_threshold: 30,
          is_acknowledged: false
        });

        websocketService.broadcastNewAlerts([alert]);
      }
    } catch (error) {
      console.error('Error checking offline nodes:', error);
    }
  }

  escalateSeverity(severity) {
    if (severity === 'low') return 'medium';
    if (severity === 'medium') return 'high';
    if (severity === 'high') return 'critical';
    return 'critical';
  }

  getThresholdAlertCooldownMinutes(rule) {
    const configuredCooldown = Number(process.env.THRESHOLD_ALERT_COOLDOWN_MINUTES);
    if (Number.isFinite(configuredCooldown) && configuredCooldown > 0) {
      return configuredCooldown;
    }

    const durationMinutes = Number(rule?.duration_minutes || 0);
    return Math.max(durationMinutes || 0, 15);
  }

  async hasRecentAlert({ alertRuleId = null, nodeId, locationId, alertType, cooldownMinutes = 15 }) {
    const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);

    const existing = await Alert.findOne({
      where: {
        node_id: nodeId,
        location_id: locationId,
        alert_type: alertType,
        ...(alertRuleId ? { alert_rule_id: alertRuleId } : {}),
        created_at: {
          [Op.gte]: since
        }
      },
      order: [['created_at', 'DESC']]
    });

    return Boolean(existing);
  }

  async createHighRiskPredictionAlert(sensorData) {
    try {
      if (!sensorData?.location_id || !sensorData?.node_id) return null;
      if (sensorData.risk_level !== 'high') return null;

      const cooldownMinutes = Number(process.env.AI_HIGH_RISK_ALERT_COOLDOWN_MINUTES || 15);
      const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);

      const existing = await Alert.findOne({
        where: {
          node_id: sensorData.node_id,
          location_id: sensorData.location_id,
          alert_type: 'ai_prediction_high_risk',
          created_at: {
            [Op.gte]: since
          }
        },
        order: [['created_at', 'DESC']]
      });

      if (existing) return existing;

      const riskScore = Number(sensorData.risk_score || 0);
      const alert = await Alert.create({
        alert_rule_id: null,
        node_id: sensorData.node_id,
        location_id: sensorData.location_id,
        alert_type: 'ai_prediction_high_risk',
        message: `AI model detected HIGH landslide risk (risk score: ${riskScore.toFixed(2)}).`,
        severity: 'high',
        parameter_value: riskScore,
        parameter_threshold: 70,
        is_acknowledged: false
      });

      websocketService.broadcastNewAlerts([alert]);
      await this.dispatchAlertNotifications(alert);
      return alert;
    } catch (error) {
      console.error('Error creating high-risk prediction alert:', error);
      return null;
    }
  }

  getFallbackThresholdBreaches(sensorData) {
    const thresholds = thingspeakConfig.thresholds || {};
    const severityOrder = ['low', 'medium', 'high', 'critical'];
    const candidates = [
      { key: 'rainfall', value: Number(sensorData.rainfall || 0), type: 'rainfall' },
      { key: 'soil_moisture', value: Number(sensorData.soil_moisture || 0), type: 'soil_moisture' },
      {
        key: 'tilt',
        value: Math.max(Math.abs(Number(sensorData.tilt_x || 0)), Math.abs(Number(sensorData.tilt_y || 0))),
        type: 'tilt'
      },
      { key: 'vibration', value: Number(sensorData.vibration || 0), type: 'vibration' }
    ];

    const breaches = [];
    for (const candidate of candidates) {
      const parameterThresholds = thresholds[candidate.key];
      if (!parameterThresholds) continue;

      let breachedLevel = null;
      for (let i = severityOrder.length - 1; i >= 0; i -= 1) {
        const level = severityOrder[i];
        const thresholdValue = Number(parameterThresholds[level]);
        if (!Number.isFinite(thresholdValue)) continue;
        if (candidate.value >= thresholdValue) {
          breachedLevel = {
            level,
            thresholdValue
          };
          break;
        }
      }

      if (!breachedLevel) continue;

      breaches.push({
        type: candidate.type,
        value: candidate.value,
        level: breachedLevel.level,
        threshold: breachedLevel.thresholdValue
      });
    }

    return breaches;
  }

  async createThresholdFallbackAlert(sensorData, reason = 'AI prediction failed') {
    try {
      if (!sensorData?.location_id || !sensorData?.node_id) return null;

      const breaches = this.getFallbackThresholdBreaches(sensorData);
      if (breaches.length === 0) return null;

      const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
      breaches.sort((a, b) => (severityRank[b.level] || 0) - (severityRank[a.level] || 0));
      const topBreach = breaches[0];

      const cooldownMinutes = Number(process.env.AI_FALLBACK_ALERT_COOLDOWN_MINUTES || 10);
      const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);

      const existing = await Alert.findOne({
        where: {
          node_id: sensorData.node_id,
          location_id: sensorData.location_id,
          alert_type: 'threshold_fallback',
          created_at: {
            [Op.gte]: since
          }
        },
        order: [['created_at', 'DESC']]
      });

      if (existing) return existing;

      const breachSummary = breaches
        .slice(0, 3)
        .map((breach) => `${breach.type}: ${breach.value.toFixed(2)} >= ${breach.threshold}`)
        .join(', ');

      const alert = await Alert.create({
        alert_rule_id: null,
        node_id: sensorData.node_id,
        location_id: sensorData.location_id,
        alert_type: 'threshold_fallback',
        message: `Threshold fallback alert (${reason}). Breaches: ${breachSummary}.`,
        severity: topBreach.level,
        parameter_value: topBreach.value,
        parameter_threshold: topBreach.threshold,
        is_acknowledged: false
      });

      websocketService.broadcastNewAlerts([alert]);
      await this.dispatchAlertNotifications(alert);
      return alert;
    } catch (error) {
      console.error('Error creating threshold fallback alert:', error);
      return null;
    }
  }

  async dispatchAlertNotifications(alert, options = {}) {
    const emailOptions = this.buildEmailRecipientOptions(alert, options);
    const smsOptions = this.buildEmailRecipientOptions(alert, options);

    const [emailResult, smsResult] = await Promise.allSettled([
      this.dispatchLandslideAlertEmailsToRegisteredUsers(alert, emailOptions),
      options.skipSms ? Promise.resolve({ skipped: true }) : this.dispatchLandslideAlertSmsToRegisteredUsers(alert, smsOptions)
    ]);

    if (emailResult.status === 'rejected') {
      console.error('Failed to dispatch email alert:', emailResult.reason?.message || emailResult.reason);
    }

    if (smsResult.status === 'rejected') {
      console.error('Failed to dispatch SMS alert:', smsResult.reason?.message || smsResult.reason);
    }
  }

  async dispatchLandslideAlertEmailsToRegisteredUsers(alert, options = {}) {
    return this.dispatchEmailAlert(alert, options);
  }

  async dispatchLandslideAlertSmsToRegisteredUsers(alert, options = {}) {
    return smsService.sendAlertSms(alert, options);
  }

  // Email notification is best-effort and must never break alert creation.
  async dispatchEmailAlert(alert, options = {}) {
    try {
      const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;
      if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !EMAIL_FROM) {
        return;
      }

      let nodemailer;
      try {
        nodemailer = require('nodemailer');
      } catch {
        console.warn('nodemailer not installed; skipping email alert dispatch.');
        return;
      }

      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASSWORD
        }
      });

      const recipients = await this.getEmailRecipients(alert.severity, options);
      const toRecipients = recipients.length > 0 ? recipients : [SMTP_USER];

      await transporter.sendMail({
        from: EMAIL_FROM,
        to: toRecipients.join(','),
        subject: `[Landslide EWS] ${String(alert.severity || 'medium').toUpperCase()} Alert`,
        text: [
          'Landslide EWS Alert',
          `Severity: ${String(alert.severity || '').toUpperCase()}`,
          `Type: ${alert.alert_type || 'N/A'}`,
          `Node: ${alert.node_id || 'N/A'}`,
          `Location ID: ${alert.location_id || 'N/A'}`,
          `Message: ${alert.message}`,
          `Timestamp: ${new Date(alert.created_at || Date.now()).toISOString()}`
        ].join('\n')
      });
    } catch (error) {
      console.error('Failed to dispatch email alert:', error.message);
    }
  }

  async getEmailRecipients(severity, options = {}) {
    try {
      const roleFilter = Array.isArray(options.roles) && options.roles.length > 0
        ? options.roles
        : null;
      const excludedRoles = Array.isArray(options.excludeRoles) && options.excludeRoles.length > 0
        ? options.excludeRoles
        : null;
      const severityKeyMap = {
        low: 'low_severity',
        medium: 'medium_severity',
        high: 'high_severity',
        critical: 'critical_severity'
      };
      const severityKey = severityKeyMap[String(severity || 'medium').toLowerCase()] || 'medium_severity';

      const settings = await Notification.findAll({
        where: {
          email_notifications: true,
          notification_frequency: 'immediate',
          [severityKey]: true
        },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['email', 'is_active'],
            where: {
              is_active: true,
              email: { [Op.ne]: null },
              ...(roleFilter ? { role: { [Op.in]: roleFilter } } : {}),
              ...(excludedRoles ? { role: { [Op.notIn]: excludedRoles } } : {})
            }
          }
        ]
      });

      if (settings.length > 0) {
        return [...new Set(
          settings
            .map((item) => item.user && item.user.email)
            .filter(Boolean)
        )];
      }

      const users = await User.findAll({
        where: {
          is_active: true,
          email: { [Op.ne]: null },
          ...(roleFilter ? { role: { [Op.in]: roleFilter } } : {}),
          ...(excludedRoles ? { role: { [Op.notIn]: excludedRoles } } : {})
        },
        attributes: ['email'],
        raw: true
      });

      return [...new Set(
        users
          .map((user) => user.email)
          .filter(Boolean)
      )];
    } catch (error) {
      console.error('Failed to resolve email recipients:', error.message);
      return [];
    }
  }

  async createSensorHealthAlert({
    nodeId,
    locationId,
    severity = 'high',
    alertType = 'sensor_health_issue',
    message,
    observedValue = 0,
    thresholdValue = 0,
    cooldownMinutes = 30
  }) {
    try {
      if (!nodeId || !locationId || !message) return null;

      const shouldSkip = await this.hasRecentAlert({
        nodeId,
        locationId,
        alertType,
        cooldownMinutes
      });

      if (shouldSkip) {
        return null;
      }

      const alert = await Alert.create({
        alert_rule_id: null,
        node_id: nodeId,
        location_id: locationId,
        alert_type: alertType,
        message,
        severity,
        parameter_value: observedValue,
        parameter_threshold: thresholdValue,
        is_acknowledged: false
      });

      websocketService.broadcastNewAlerts([alert]);
      await this.dispatchAlertNotifications(alert, {
        roles: ['admin'],
        skipSms: true
      });
      return alert;
    } catch (error) {
      console.error('Error creating sensor health alert:', error);
      return null;
    }
  }

  // ================================
  // ALERT STATISTICS
  // ================================
  async getAlertStats(timeframe = '24h') {
    const since = new Date();

    if (timeframe === '1h') since.setHours(since.getHours() - 1);
    else if (timeframe === '6h') since.setHours(since.getHours() - 6);
    else if (timeframe === '7d') since.setDate(since.getDate() - 7);
    else since.setDate(since.getDate() - 1);

    return Alert.findAll({
      where: {
        created_at: { [Op.gte]: since }
      },
      attributes: [
        'severity',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['severity'],
      raw: true
    });
  }
}

module.exports = new AlertService();

