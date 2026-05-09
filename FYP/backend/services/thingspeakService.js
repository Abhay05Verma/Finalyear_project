const axios = require('axios');
const cron = require('node-cron');
const thingspeakConfig = require('../config/thingspeak');
const { SensorData, SensorNode, Location } = require('../models');
const { calculateRiskScore, determineRiskLevel } = require('./riskCalculationService');
const websocketService = require('./websocketService');
const alertService = require('./alertService');
const aiPredictionService = require('./aiPredictionService');

class ThingSpeakService {
  constructor() {
    this.isRunning = false;
    this.fetchInterval = thingspeakConfig.fetchInterval;
    this.maxDataAgeMs = parseInt(process.env.THINGSPEAK_MAX_DATA_AGE_MS || '900000', 10); // 15 min
  }

  async updateNodeHeartbeat(nodeId, batteryLevel, lastSeenAt = new Date()) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await SensorNode.update({
          last_seen: lastSeenAt,
          status: 'online',
          battery_level: batteryLevel
        }, {
          where: { node_id: nodeId }
        });
        return;
      } catch (error) {
        const isRetryable = error && (
          error.code === 'ER_NEED_REPREPARE' ||
          error.parent?.code === 'ER_NEED_REPREPARE' ||
          error.original?.code === 'ER_NEED_REPREPARE'
        );

        if (!isRetryable || attempt === maxAttempts) {
          throw error;
        }

        const waitMs = 200 * attempt;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  // Fetch data from ThingSpeak for a specific channel
  async fetchChannelData(channelId, readKey, nodeId) {
    try {
      const channelConfig = thingspeakConfig.channels[nodeId];
      if (channelConfig?.mock) {
        const mockFeed = this.generateMockFeed(nodeId, channelConfig.mockProfile);
        await this.processThingSpeakData(mockFeed, nodeId);
        return true;
      }

      const url = `${thingspeakConfig.baseUrl}/channels/${channelId}/feeds.json`;
      
      const response = await axios.get(url, {
        params: {
          api_key: readKey,
          results: thingspeakConfig.maxResults
        },
        timeout: 10000
      });

      if (response.data && response.data.feeds && response.data.feeds.length > 0) {
        const latestFeed = response.data.feeds[response.data.feeds.length - 1];
        const shouldProcess = await this.shouldProcessFeed(latestFeed, nodeId);
        if (!shouldProcess) {
          return false;
        }
        await this.processThingSpeakData(latestFeed, nodeId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error fetching ThingSpeak data for channel ${channelId}:`, error.message);
      return false;
    }
  }

  async shouldProcessFeed(feed, nodeId) {
    try {
      const feedTimestamp = new Date(feed.created_at);
      if (Number.isNaN(feedTimestamp.getTime())) {
        console.warn(`Skipping ThingSpeak feed for ${nodeId}: invalid timestamp`);
        return false;
      }

      const allowStale = process.env.THINGSPEAK_ALLOW_STALE === 'true';
      if (!allowStale && (Date.now() - feedTimestamp.getTime()) > this.maxDataAgeMs) {
        console.warn(
          `Skipping stale ThingSpeak feed for ${nodeId}: ${feed.created_at}`
        );
        return false;
      }

      const latestSaved = await SensorData.findOne({
        where: { node_id: nodeId },
        attributes: ['reading_timestamp'],
        order: [['reading_timestamp', 'DESC']]
      });

      if (
        latestSaved &&
        new Date(latestSaved.reading_timestamp).getTime() >= feedTimestamp.getTime()
      ) {
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Error validating ThingSpeak feed for ${nodeId}:`, error.message);
      return false;
    }
  }

  generateMockFeed(nodeId, profile = 'default') {
    const now = new Date();
    const minuteSeed = now.getUTCMinutes();
    const secondSeed = now.getUTCSeconds();

    const mockProfiles = {
      raigarh: {
        rainfallBase: 17,
        rainfallVariance: 8,
        soilMoistureBase: 66,
        soilMoistureVariance: 10,
        tiltXBase: 1.8,
        tiltYBase: 1.4,
        tiltVariance: 1.1,
        vibrationBase: 0.72,
        vibrationVariance: 0.45,
        temperatureBase: 28,
        temperatureVariance: 3,
        pressureBase: 1003,
        pressureVariance: 5,
        batteryBase: 81,
        batteryVariance: 6
      },
      default: {
        rainfallBase: 10,
        rainfallVariance: 5,
        soilMoistureBase: 55,
        soilMoistureVariance: 8,
        tiltXBase: 1.1,
        tiltYBase: 0.9,
        tiltVariance: 0.8,
        vibrationBase: 0.4,
        vibrationVariance: 0.25,
        temperatureBase: 27,
        temperatureVariance: 2,
        pressureBase: 1008,
        pressureVariance: 4,
        batteryBase: 88,
        batteryVariance: 4
      }
    };

    const selectedProfile = mockProfiles[profile] || mockProfiles.default;
    const wave = Math.sin((minuteSeed + secondSeed / 60) / 60 * Math.PI * 2);
    const pulse = Math.cos(secondSeed / 60 * Math.PI * 2);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const round = (value) => Number(value.toFixed(2));

    return {
      created_at: now.toISOString(),
      entry_id: Date.now(),
      field1: round(clamp(selectedProfile.rainfallBase + wave * selectedProfile.rainfallVariance, 0, 80)),
      field2: round(clamp(selectedProfile.soilMoistureBase + pulse * selectedProfile.soilMoistureVariance, 20, 95)),
      field3: round(clamp(selectedProfile.tiltXBase + wave * selectedProfile.tiltVariance, -10, 10)),
      field4: round(clamp(selectedProfile.tiltYBase + pulse * selectedProfile.tiltVariance, -10, 10)),
      field5: round(clamp(selectedProfile.vibrationBase + Math.abs(wave) * selectedProfile.vibrationVariance, 0, 6)),
      field6: round(clamp(selectedProfile.temperatureBase + pulse * selectedProfile.temperatureVariance, 10, 45)),
      field7: round(clamp(selectedProfile.pressureBase + wave * selectedProfile.pressureVariance, 950, 1050)),
      field8: round(clamp(selectedProfile.batteryBase - Math.abs(pulse) * selectedProfile.batteryVariance, 15, 100))
    };
  }

  // Process ThingSpeak feed data and save to database
  async processThingSpeakData(feed, nodeId) {
    try {
      const channelConfig = thingspeakConfig.channels[nodeId];
      if (!channelConfig) {
        console.error(`No configuration found for node ${nodeId}`);
        return;
      }

      // Extract data using field mappings
      const sensorData = {
        node_id: nodeId,
        location_id: await this.getLocationIdForNode(nodeId),
        reading_timestamp: new Date(feed.created_at)
      };

      // Map ThingSpeak fields to database columns
      Object.entries(channelConfig.fieldMappings).forEach(([field, column]) => {
        if (feed[field] && feed[field] !== '') {
          sensorData[column] = parseFloat(feed[field]);
        }
      });

      // AI prediction first; fallback to current heuristic scoring if unavailable.
      let predictionSource = 'ai';
      let predictionProbability = null;
      let aiFallbackReason = null;
      try {
        const aiPrediction = await aiPredictionService.predict(sensorData);
        sensorData.risk_score = aiPrediction.riskScore;
        sensorData.risk_level = aiPrediction.riskLevel;
        predictionProbability = aiPrediction.probability;
        console.log('[AI] Running prediction');
        console.log(`[AI] Risk Score: ${aiPrediction.probability.toFixed(2)}`);
        console.log(
          `[AI] node=${nodeId} prediction=${aiPrediction.prediction} probability=${aiPrediction.probability.toFixed(4)} risk_score=${aiPrediction.riskScore} risk_level=${aiPrediction.riskLevel}`
        );
      } catch (aiError) {
        const fallbackRiskScore = calculateRiskScore(
          sensorData.rainfall || 0,
          sensorData.soil_moisture || 0,
          sensorData.tilt_x || 0,
          sensorData.tilt_y || 0,
          sensorData.vibration || 0
        );

        sensorData.risk_score = fallbackRiskScore;
        sensorData.risk_level = determineRiskLevel(fallbackRiskScore);
        predictionSource = 'heuristic';
        aiFallbackReason = aiError.message;
        console.error(`AI prediction fallback for node ${nodeId}:`, aiError.message);
      }

      // Save to database
      const savedData = await SensorData.create(sensorData);

      // Update node heartbeat and online status.
      await this.updateNodeHeartbeat(
        nodeId,
        sensorData.battery ?? null,
        sensorData.reading_timestamp
      );

      // Check for alerts
      await alertService.checkForAlerts(savedData);
      if (predictionSource === 'heuristic') {
        await alertService.createThresholdFallbackAlert(
          savedData,
          aiFallbackReason || 'AI prediction unavailable'
        );
      }

      if (savedData.risk_level === 'high') {
        await alertService.createHighRiskPredictionAlert(savedData);
      }

      // Broadcast update via WebSocket
      websocketService.broadcastSensorUpdate(savedData);

      console.log(`✅ Data saved for node ${nodeId}:`, {
        risk_score: savedData.risk_score,
        risk_level: sensorData.risk_level,
        prediction_source: predictionSource,
        prediction_probability: predictionProbability,
        timestamp: new Date().toISOString()
      });

      return savedData;
    } catch (error) {
      console.error(`Error processing ThingSpeak data for node ${nodeId}:`, error);
    }
  }

  async getLocationIdForNode(nodeId) {
    try {
      const node = await SensorNode.findOne({
        where: { node_id: nodeId },
        include: [{ model: Location, as: 'location' }]
      });
      
      return node ? node.location_id : 1; // Default to location 1 if not found
    } catch (error) {
      console.error(`Error getting location for node ${nodeId}:`, error);
      return 1; // Default location
    }
  }

  // Fetch data for all configured channels
  async fetchAllChannelsData() {
    console.log('🔄 Fetching data from ThingSpeak...');
    
    const promises = Object.entries(thingspeakConfig.channels).map(
      async ([nodeId, config]) => {
        try {
          await this.fetchChannelData(config.channelId, config.readKey, nodeId);
        } catch (error) {
          console.error(`Error fetching data for node ${nodeId}:`, error.message);
        }
      }
    );

    await Promise.allSettled(promises);
    console.log('✅ ThingSpeak data fetch completed');
  }




  // Start automatic data fetching
  startDataFetching() {
  if (this.isRunning) return;

  this.fetchAllChannelsData(); // immediate fetch

  const intervalMs = parseInt(this.fetchInterval) || 60000;

  setInterval(() => {
    console.log(`⏰ Fetching ThingSpeak data (every ${intervalMs} ms)`);
    this.fetchAllChannelsData();
  }, intervalMs);

  this.isRunning = true;
  console.log(`🔄 ThingSpeak data fetching started`);
}











  // Manual data fetch endpoint
  async manualFetch() {
    try {
      await this.fetchAllChannelsData();
      return { success: true, message: 'Data fetched successfully' };
    } catch (error) {
      console.error('Manual fetch error:', error);
      return { success: false, message: error.message };
    }
  }

  // Get ThingSpeak channel status
  async getChannelStatus() {
    const status = [];
    
    for (const [nodeId, config] of Object.entries(thingspeakConfig.channels)) {
      try {
        const url = `${thingspeakConfig.baseUrl}/channels/${config.channelId}/feeds.json`;
        const response = await axios.get(url, {
          params: { api_key: config.readKey, results: 1 },
          timeout: 5000
        });

        status.push({
          node_id: nodeId,
          channel_id: config.channelId,
          status: 'connected',
          last_update: response.data.feeds.length > 0 ? response.data.feeds[0].created_at : 'No data',
          entry_count: response.data.channel.last_entry_id
        });
      } catch (error) {
        status.push({
          node_id: nodeId,
          channel_id: config.channelId,
          status: 'error',
          error: error.message
        });
      }
    }

    return status;
  }
}

module.exports = new ThingSpeakService();
