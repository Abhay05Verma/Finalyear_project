module.exports = {
  // ThingSpeak API Configuration
  apiKey: process.env.THINGSPEAK_API_KEY || 'YOUR_THINGSPEAK_API_KEY',
  baseUrl: 'https://api.thingspeak.com',
  
  // Channel mappings (Map ThingSpeak channel IDs to your sensor nodes)
  channels: {
    'NODE-001': {
      channelId: process.env.THINGSPEAK_CHANNEL_1 || '1234567',
      readKey: process.env.THINGSPEAK_READ_KEY_1 || 'YOUR_READ_KEY_1',
      fieldMappings: {
        field1: 'rainfall',      // mm/hr
        field2: 'soil_moisture', // percentage
        field3: 'tilt_x',        // degrees
        field4: 'tilt_y',        // degrees
        field5: 'vibration',     // g-force
        field6: 'temperature',   // celsius
        field7: 'pressure',      // hPa
        field8: 'battery'        // percentage
      }
    },
    'NODE-002': {
      mock: true,
      mockProfile: 'raigarh',
      channelId: process.env.THINGSPEAK_CHANNEL_2 || 'MOCK_NODE_2_RAIGARH',
      readKey: process.env.THINGSPEAK_READ_KEY_2 || 'MOCK_READ_KEY_2_RAIGARH',
      fieldMappings: {
        field1: 'rainfall',
        field2: 'soil_moisture',
        field3: 'tilt_x',
        field4: 'tilt_y',
        field5: 'vibration',
        field6: 'temperature',
        field7: 'pressure',
        field8: 'battery'
      }
    },

    /*
    'NODE-003': {
      channelId: process.env.THINGSPEAK_CHANNEL_3 || '1234569',
      readKey: process.env.THINGSPEAK_READ_KEY_3 || 'YOUR_READ_KEY_3',
      fieldMappings: {
        field1: 'rainfall',
        field2: 'soil_moisture',
        field3: 'tilt_x',
        field4: 'tilt_y',
        field5: 'vibration',
        field6: 'temperature',
        field7: 'pressure',
        field8: 'battery'
      }
    }*/
  },
  
  // Fetch settings
  fetchInterval: process.env.THINGSPEAK_FETCH_INTERVAL || 20000, // 20 seconds
  maxResults: 1, // Number of results to fetch per request
  
  // Alert thresholds (for reference)
  thresholds: {
    rainfall: {
      low: 10,    // mm/hr
      medium: 25, // mm/hr
      high: 40,   // mm/hr
      critical: 60 // mm/hr
    },
    soil_moisture: {
      low: 40,    // %
      medium: 60, // %
      high: 75,   // %
      critical: 85 // %
    },
    tilt: {
      low: 2,     // degrees
      medium: 5,  // degrees
      high: 8,    // degrees
      critical: 12 // degrees
    },
    vibration: {
      low: 1.0,   // g
      medium: 2.0, // g
      high: 3.5,  // g
      critical: 5.0 // g
    }
  }
};
