require('dotenv').config();
const alertService = require('../services/alertService');

console.log('🚨 Starting alert monitoring cron job...');

// Run alert checks immediately
alertService.checkUnresolvedAlerts()
  .then(() => {
    console.log('✅ Alert checks completed');
    return alertService.checkOfflineNodes();
  })
  .then(() => {
    console.log('✅ Node status checks completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error in alert monitoring:', error);
    process.exit(1);
  });