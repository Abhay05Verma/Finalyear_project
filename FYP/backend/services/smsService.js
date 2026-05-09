const axios = require('axios');
const { Op } = require('sequelize');
const { User, Location, Notification, SmsLog } = require('../models');

class SmsService {
  constructor() {
    this.severityRank = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
  }

  normalizeMobileNumber(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const normalized = raw.replace(/[^\d+]/g, '');
    return normalized || null;
  }

  formatMsg91Mobile(value, countryCode = '91') {
    const normalized = this.normalizeMobileNumber(value);
    if (!normalized) return null;

    const digitsOnly = normalized.replace(/^\+/, '');
    if (digitsOnly.startsWith(countryCode) && digitsOnly.length > 10) {
      return digitsOnly;
    }

    return `${countryCode}${digitsOnly}`;
  }

  shouldSendForSeverity(severity) {
    const minimumSeverity = String(process.env.SMS_MIN_SEVERITY || 'high').toLowerCase();
    const currentSeverity = String(severity || 'medium').toLowerCase();
    return (this.severityRank[currentSeverity] || 0) >= (this.severityRank[minimumSeverity] || 0);
  }

  async getActiveRecipients(severity, options = {}) {
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
        sms_notifications: true,
        notification_frequency: 'immediate',
        [severityKey]: true
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['mobile_number', 'is_active', 'role'],
          where: {
            is_active: true,
            mobile_number: {
              [Op.ne]: null
            },
            ...(roleFilter ? { role: { [Op.in]: roleFilter } } : {}),
            ...(excludedRoles ? { role: { [Op.notIn]: excludedRoles } } : {})
          }
        }
      ]
    });

    if (settings.length > 0) {
      return [...new Set(
        settings
          .map((item) => item.user && this.normalizeMobileNumber(item.user.mobile_number))
          .filter(Boolean)
      )];
    }

    const users = await User.findAll({
      where: {
        is_active: true,
        mobile_number: {
          [Op.ne]: null
        },
        ...(roleFilter ? { role: { [Op.in]: roleFilter } } : {}),
        ...(excludedRoles ? { role: { [Op.notIn]: excludedRoles } } : {})
      },
      attributes: ['mobile_number'],
      raw: true
    });

    return [...new Set(
      users
        .map((user) => this.normalizeMobileNumber(user.mobile_number))
        .filter(Boolean)
    )];
  }

  async getLocationName(locationId) {
    if (!locationId) return 'the monitored area';

    const location = await Location.findByPk(locationId, {
      attributes: ['name'],
      raw: true
    });

    return location?.name || `location ${locationId}`;
  }

  buildMessage(locationName, alert) {
    const severity = String(alert?.severity || 'medium').toUpperCase();
    const type = String(alert?.alert_type || 'landslide_alert').replace(/_/g, ' ');
    return `ALERT: ${severity} landslide warning at ${locationName}. Type: ${type}. ${alert?.message || 'Please move to a safe location immediately.'}`;
  }

  getMsg91Config() {
    const {
      MSG91_AUTH_KEY,
      MSG91_TEMPLATE_ID,
      MSG91_SENDER_ID,
      MSG91_COUNTRY = '91',
      MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/'
    } = process.env;

    return {
      authKey: MSG91_AUTH_KEY,
      templateId: MSG91_TEMPLATE_ID,
      senderId: MSG91_SENDER_ID,
      countryCode: MSG91_COUNTRY,
      flowUrl: MSG91_FLOW_URL
    };
  }

  async createSmsLog(payload) {
    if (String(process.env.SMS_LOG_TO_DB || 'true').toLowerCase() !== 'true') {
      return null;
    }

    try {
      return await SmsLog.create(payload);
    } catch (error) {
      console.error('[SMS] Failed to persist SMS log:', error.message);
      return null;
    }
  }

  async updateSmsLog(smsLog, payload) {
    if (!smsLog) return;

    try {
      await smsLog.update(payload);
    } catch (error) {
      console.error('[SMS] Failed to update SMS log:', error.message);
    }
  }

  async sendViaMsg91({ mobileNumber, message, locationName, alert }) {
    const config = this.getMsg91Config();
    if (!config.authKey || !config.templateId || !config.senderId) {
      throw new Error('MSG91 configuration is incomplete');
    }

    const formattedMobile = this.formatMsg91Mobile(mobileNumber, config.countryCode);
    if (!formattedMobile) {
      throw new Error(`Invalid mobile number: ${mobileNumber}`);
    }

    const payload = {
      template_id: config.templateId,
      short_url: '0',
      sender: config.senderId,
      recipients: [
        {
          mobiles: formattedMobile,
          VAR1: locationName,
          VAR2: String(alert.severity || 'medium').toUpperCase(),
          VAR3: String(alert.alert_type || 'landslide_alert'),
          VAR4: message
        }
      ]
    };

    const response = await axios.post(config.flowUrl, payload, {
      headers: {
        authkey: config.authKey,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      timeout: Number(process.env.SMS_TIMEOUT_MS || 10000)
    });

    return response.data;
  }

  async sendWithRetry({ mobileNumber, message, locationName, alert }) {
    const maxRetries = Number(process.env.SMS_MAX_RETRIES || 2);
    const smsLog = await this.createSmsLog({
      alert_id: alert.id,
      mobile_number: mobileNumber,
      provider: 'MSG91',
      status: 'pending',
      attempt_count: 0,
      severity: alert.severity,
      location_name: locationName,
      message
    });

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const response = await this.sendViaMsg91({
          mobileNumber,
          message,
          locationName,
          alert
        });

        console.log(`[SMS] Sent alert ${alert.id} to ${mobileNumber} on attempt ${attempt}`);
        await this.updateSmsLog(smsLog, {
          status: 'sent',
          attempt_count: attempt,
          provider_response: JSON.stringify(response),
          error_message: null,
          sent_at: new Date()
        });

        return {
          success: true,
          mobileNumber,
          attempts: attempt,
          response
        };
      } catch (error) {
        lastError = error;
        const errorMessage = error.response?.data
          ? JSON.stringify(error.response.data)
          : error.message;

        console.error(
          `[SMS] Failed to send alert ${alert.id} to ${mobileNumber} on attempt ${attempt}: ${errorMessage}`
        );

        await this.updateSmsLog(smsLog, {
          status: attempt > maxRetries ? 'failed' : 'pending',
          attempt_count: attempt,
          provider_response: error.response?.data ? JSON.stringify(error.response.data) : null,
          error_message: errorMessage
        });

        if (attempt <= maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    return {
      success: false,
      mobileNumber,
      attempts: maxRetries + 1,
      error: lastError?.message || 'Unknown SMS error'
    };
  }

  async sendAlertSms(alert, options = {}) {
    try {
      if (!alert?.id) {
        return { attempted: false, reason: 'missing_alert' };
      }

      if (!this.shouldSendForSeverity(alert.severity)) {
        console.log(`[SMS] Skipped alert ${alert.id}; severity ${alert.severity} is below threshold.`);
        await this.createSmsLog({
          alert_id: alert.id,
          mobile_number: 'broadcast',
          provider: 'MSG91',
          status: 'skipped',
          attempt_count: 0,
          severity: alert.severity,
          location_name: null,
          message: 'SMS skipped because severity is below configured threshold.',
          error_message: `Minimum severity is ${process.env.SMS_MIN_SEVERITY || 'high'}`
        });
        return { attempted: false, reason: 'severity_below_threshold' };
      }

      const recipients = await this.getActiveRecipients(alert.severity, options);
      if (recipients.length === 0) {
        console.warn(`[SMS] No active recipients found for alert ${alert.id}.`);
        return { attempted: false, reason: 'no_recipients' };
      }

      const locationName = await this.getLocationName(alert.location_id);
      const message = this.buildMessage(locationName, alert);

      const results = [];
      for (const mobileNumber of recipients) {
        results.push(await this.sendWithRetry({
          mobileNumber,
          message,
          locationName,
          alert
        }));
      }

      const succeeded = results.filter((result) => result.success).length;
      const failed = results.length - succeeded;

      console.log(
        `[SMS] Alert ${alert.id} dispatch completed. Sent: ${succeeded}, Failed: ${failed}, Severity: ${alert.severity}`
      );

      return {
        attempted: true,
        total: results.length,
        succeeded,
        failed,
        results
      };
    } catch (error) {
      console.error(`[SMS] Alert ${alert?.id || 'unknown'} dispatch failed:`, error.message);
      return {
        attempted: true,
        total: 0,
        succeeded: 0,
        failed: 0,
        error: error.message
      };
    }
  }
}

module.exports = new SmsService();
