require('dotenv').config();
const thingspeakService = require('../services/thingspeakService');

console.log('🔄 Starting ThingSpeak data fetch cron job...');

// Fetch data immediately
thingspeakService.fetchAllChannelsData()
  .then(() => {
    console.log('✅ Initial data fetch completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error in data fetch:', error);
    process.exit(1);
  });