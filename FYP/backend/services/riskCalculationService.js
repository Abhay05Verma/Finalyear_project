const thingspeakConfig = require('../config/thingspeak');

// Calculate risk score based on sensor readings
function calculateRiskScore(rainfall, soilMoisture, tiltX, tiltY, vibration) {
  let riskScore = 0;
  
  // Rainfall weight: 30%
  const rainfallScore = Math.min(30, (rainfall / thingspeakConfig.thresholds.rainfall.critical) * 30);
  riskScore += rainfallScore;
  
  // Soil moisture weight: 25%
  const soilMoistureScore = Math.min(25, (soilMoisture / 100) * 25);
  riskScore += soilMoistureScore;
  
  // Tilt weight: 25% (using maximum tilt)
  const maxTilt = Math.max(Math.abs(tiltX), Math.abs(tiltY));
  const tiltScore = Math.min(25, (maxTilt / thingspeakConfig.thresholds.tilt.critical) * 25);
  riskScore += tiltScore;
  
  // Vibration weight: 20%
  const vibrationScore = Math.min(20, (vibration / thingspeakConfig.thresholds.vibration.critical) * 20);
  riskScore += vibrationScore;
  
  // Additional risk factors
  if (rainfall > thingspeakConfig.thresholds.rainfall.medium && 
      soilMoisture > thingspeakConfig.thresholds.soil_moisture.medium) {
    riskScore += 10; // Combined effect
  }
  
  return Math.min(100, Math.round(riskScore));
}

// Determine risk level based on score
function determineRiskLevel(riskScore) {
  if (riskScore <= 20) return 'normal';
  if (riskScore <= 40) return 'low';
  if (riskScore <= 60) return 'medium';
  if (riskScore <= 80) return 'high';
  return 'critical';
}

// Calculate individual parameter risks
function calculateParameterRisks(data) {
  const risks = {};
  
  // Rainfall risk
  if (data.rainfall > thingspeakConfig.thresholds.rainfall.critical) risks.rainfall = 'critical';
  else if (data.rainfall > thingspeakConfig.thresholds.rainfall.high) risks.rainfall = 'high';
  else if (data.rainfall > thingspeakConfig.thresholds.rainfall.medium) risks.rainfall = 'medium';
  else if (data.rainfall > thingspeakConfig.thresholds.rainfall.low) risks.rainfall = 'low';
  else risks.rainfall = 'normal';
  
  // Soil moisture risk
  if (data.soil_moisture > thingspeakConfig.thresholds.soil_moisture.critical) risks.soil_moisture = 'critical';
  else if (data.soil_moisture > thingspeakConfig.thresholds.soil_moisture.high) risks.soil_moisture = 'high';
  else if (data.soil_moisture > thingspeakConfig.thresholds.soil_moisture.medium) risks.soil_moisture = 'medium';
  else if (data.soil_moisture > thingspeakConfig.thresholds.soil_moisture.low) risks.soil_moisture = 'low';
  else risks.soil_moisture = 'normal';
  
  // Tilt risk (using maximum tilt)
  const maxTilt = Math.max(Math.abs(data.tilt_x || 0), Math.abs(data.tilt_y || 0));
  if (maxTilt > thingspeakConfig.thresholds.tilt.critical) risks.tilt = 'critical';
  else if (maxTilt > thingspeakConfig.thresholds.tilt.high) risks.tilt = 'high';
  else if (maxTilt > thingspeakConfig.thresholds.tilt.medium) risks.tilt = 'medium';
  else if (maxTilt > thingspeakConfig.thresholds.tilt.low) risks.tilt = 'low';
  else risks.tilt = 'normal';
  
  // Vibration risk
  if (data.vibration > thingspeakConfig.thresholds.vibration.critical) risks.vibration = 'critical';
  else if (data.vibration > thingspeakConfig.thresholds.vibration.high) risks.vibration = 'high';
  else if (data.vibration > thingspeakConfig.thresholds.vibration.medium) risks.vibration = 'medium';
  else if (data.vibration > thingspeakConfig.thresholds.vibration.low) risks.vibration = 'low';
  else risks.vibration = 'normal';
  
  return risks;
}

// Get risk assessment message
function getRiskAssessment(riskScore, parameterRisks) {
  const criticalParams = Object.entries(parameterRisks).filter(([_, level]) => level === 'critical');
  const highParams = Object.entries(parameterRisks).filter(([_, level]) => level === 'high');
  
  if (riskScore >= 80 || criticalParams.length > 0) {
    return 'CRITICAL RISK - Immediate action required!';
  } else if (riskScore >= 60 || highParams.length > 0) {
    return 'High risk - Prepare for action';
  } else if (riskScore >= 40) {
    return 'Moderate risk - Monitor closely';
  } else if (riskScore >= 20) {
    return 'Slight elevation in some parameters';
  } else {
    return 'All parameters within normal range';
  }
}

module.exports = {
  calculateRiskScore,
  determineRiskLevel,
  calculateParameterRisks,
  getRiskAssessment
};