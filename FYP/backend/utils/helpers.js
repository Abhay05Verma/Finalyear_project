// Generate random sensor data for testing
function generateMockSensorData(nodeId, locationId) {
  const now = new Date();
  
  // Base values with some randomness
  const rainfall = parseFloat((Math.random() * 30).toFixed(2)); // 0-30 mm/hr
  const soil_moisture = parseFloat((Math.random() * 60 + 20).toFixed(2)); // 20-80%
  const tilt_x = parseFloat((Math.random() * 6 - 3).toFixed(2)); // -3 to 3 degrees
  const tilt_y = parseFloat((Math.random() * 6 - 3).toFixed(2)); // -3 to 3 degrees
  const vibration = parseFloat((Math.random() * 2.5).toFixed(3)); // 0-2.5 g
  const temperature = parseFloat((Math.random() * 15 + 15).toFixed(2)); // 15-30°C
  const pressure = parseFloat((Math.random() * 40 + 980).toFixed(2)); // 980-1020 hPa
  const battery = parseFloat((Math.random() * 50 + 50).toFixed(2)); // 50-100%
  
  // Calculate risk score
  const { calculateRiskScore, determineRiskLevel } = require('../services/riskCalculationService');
  const riskScore = calculateRiskScore(rainfall, soil_moisture, tilt_x, tilt_y, vibration);
  const riskLevel = determineRiskLevel(riskScore);
  
  return {
    node_id: nodeId,
    location_id: locationId,
    rainfall,
    soil_moisture,
    tilt_x,
    tilt_y,
    vibration,
    temperature,
    pressure,
    battery,
    risk_score: riskScore,
    risk_level: riskLevel,
    reading_timestamp: new Date(now.getTime() - Math.random() * 60000) // Within last minute
  };
}

// Format bytes to human readable format
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Calculate time difference in human readable format
function timeDifference(current, previous) {
  const msPerMinute = 60 * 1000;
  const msPerHour = msPerMinute * 60;
  const msPerDay = msPerHour * 24;
  const msPerMonth = msPerDay * 30;
  const msPerYear = msPerDay * 365;
  
  const elapsed = current - previous;
  
  if (elapsed < msPerMinute) {
    return Math.round(elapsed / 1000) + ' seconds ago';
  } else if (elapsed < msPerHour) {
    return Math.round(elapsed / msPerMinute) + ' minutes ago';
  } else if (elapsed < msPerDay) {
    return Math.round(elapsed / msPerHour) + ' hours ago';
  } else if (elapsed < msPerMonth) {
    return Math.round(elapsed / msPerDay) + ' days ago';
  } else if (elapsed < msPerYear) {
    return Math.round(elapsed / msPerMonth) + ' months ago';
  } else {
    return Math.round(elapsed / msPerYear) + ' years ago';
  }
}

// Validate email format
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Generate secure random string
function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  
  return result;
}

// Debounce function for limiting API calls
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function for limiting API calls
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Parse query parameters for database queries
function parseQueryParams(query) {
  const params = {};
  
  // Pagination
  if (query.page) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    params.offset = (page - 1) * limit;
    params.limit = limit;
  }
  
  // Date range
  if (query.start_date || query.end_date) {
    params.where = params.where || {};
    params.where.created_at = {};
    
    if (query.start_date) {
      params.where.created_at.$gte = new Date(query.start_date);
    }
    
    if (query.end_date) {
      params.where.created_at.$lte = new Date(query.end_date);
    }
  }
  
  // Other filters
  const filterFields = ['status', 'severity', 'node_id', 'location_id', 'is_acknowledged'];
  filterFields.forEach(field => {
    if (query[field] !== undefined) {
      params.where = params.where || {};
      params.where[field] = query[field];
    }
  });
  
  // Sorting
  if (query.sort_by) {
    const direction = query.sort_order === 'desc' ? 'DESC' : 'ASC';
    params.order = [[query.sort_by, direction]];
  }
  
  return params;
}

// Check if value is within range
function isWithinRange(value, min, max) {
  return value >= min && value <= max;
}

// Get color based on risk level
function getRiskColor(riskLevel) {
  switch(riskLevel.toLowerCase()) {
    case 'critical':
      return '#dc3545'; // Red
    case 'high':
      return '#fd7e14'; // Orange
    case 'medium':
      return '#ffc107'; // Yellow
    case 'low':
      return '#17a2b8'; // Teal
    case 'normal':
      return '#28a745'; // Green
    default:
      return '#6c757d'; // Gray
  }
}

// Get icon based on sensor type
function getSensorIcon(sensorType) {
  switch(sensorType) {
    case 'rainfall':
      return 'fa-cloud-rain';
    case 'soil_moisture':
      return 'fa-tint';
    case 'tilt':
      return 'fa-balance-scale';
    case 'vibration':
      return 'fa-wave-square';
    case 'temperature':
      return 'fa-thermometer-half';
    case 'multi':
      return 'fa-microchip';
    default:
      return 'fa-sensor';
  }
}

module.exports = {
  generateMockSensorData,
  formatBytes,
  timeDifference,
  isValidEmail,
  generateRandomString,
  debounce,
  throttle,
  parseQueryParams,
  isWithinRange,
  getRiskColor,
  getSensorIcon
};