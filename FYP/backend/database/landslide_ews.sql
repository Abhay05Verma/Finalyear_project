-- Complete MySQL Database Schema for Landslide EWS

-- Create Database
CREATE DATABASE IF NOT EXISTS landslide_ews;
USE landslide_ews;

-- Users Table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    mobile_number VARCHAR(20) NULL,
    role ENUM('admin', 'operator', 'viewer', 'visitor') DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_is_active (is_active)
);

-- Locations Table
CREATE TABLE locations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    altitude DECIMAL(8, 2),
    region VARCHAR(100),
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_location (latitude, longitude),
    INDEX idx_risk_level (risk_level)
);

-- Sensor Nodes Table
CREATE TABLE sensor_nodes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    node_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    location_id INT NOT NULL,
    sensor_type ENUM('rainfall', 'soil_moisture', 'tilt', 'vibration', 'temperature', 'multi') DEFAULT 'multi',
    status ENUM('online', 'offline', 'maintenance') DEFAULT 'offline',
    battery_level DECIMAL(5, 2) DEFAULT 100.00,
    last_seen TIMESTAMP NULL,
    firmware_version VARCHAR(20),
    hardware_version VARCHAR(20),
    installation_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    INDEX idx_node_id (node_id),
    INDEX idx_status (status),
    INDEX idx_location (location_id),
    INDEX idx_last_seen (last_seen)
);

-- Sensor Data Table
CREATE TABLE sensor_data (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    node_id VARCHAR(50) NOT NULL,
    location_id INT NOT NULL,
    rainfall DECIMAL(6, 2) COMMENT 'mm/hr',
    soil_moisture DECIMAL(5, 2) COMMENT 'percentage',
    tilt_x DECIMAL(5, 2) COMMENT 'degrees',
    tilt_y DECIMAL(5, 2) COMMENT 'degrees',
    vibration DECIMAL(5, 3) COMMENT 'g-force',
    temperature DECIMAL(5, 2) COMMENT 'celsius',
    pressure DECIMAL(7, 2) COMMENT 'hPa',
    battery DECIMAL(5, 2) COMMENT 'percentage',
    signal_strength DECIMAL(5, 2) COMMENT 'dBm',
    risk_score TINYINT UNSIGNED DEFAULT 0 COMMENT '0-100 percentage',
    risk_level ENUM('normal', 'low', 'medium', 'high', 'critical') DEFAULT 'normal',
    reading_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES sensor_nodes(node_id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    INDEX idx_node_timestamp (node_id, reading_timestamp),
    INDEX idx_location_timestamp (location_id, reading_timestamp),
    INDEX idx_risk_level (risk_level),
    INDEX idx_timestamp (reading_timestamp),
    INDEX idx_risk_score (risk_score)
);

-- Alert Rules Table
CREATE TABLE alert_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parameter ENUM('rainfall', 'soil_moisture', 'tilt', 'vibration', 'temperature', 'risk_score', 'battery') NOT NULL,
    operator ENUM('>', '>=', '<', '<=', '=', '!=') NOT NULL,
    threshold_value DECIMAL(10, 3) NOT NULL,
    duration_minutes INT DEFAULT 5 COMMENT 'Condition must persist for this many minutes',
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    is_active BOOLEAN DEFAULT TRUE,
    location_id INT NULL COMMENT 'NULL means applies to all locations',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_parameter (parameter),
    INDEX idx_severity (severity),
    INDEX idx_is_active (is_active)
);

-- Alerts Table
CREATE TABLE alerts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    alert_rule_id INT NULL,
    node_id VARCHAR(50) NOT NULL,
    location_id INT NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    parameter_value DECIMAL(10, 3) NOT NULL,
    parameter_threshold DECIMAL(10, 3) NOT NULL,
    is_acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by INT NULL,
    acknowledged_at TIMESTAMP NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL,
    FOREIGN KEY (node_id) REFERENCES sensor_nodes(node_id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_created_at (created_at),
    INDEX idx_severity (severity),
    INDEX idx_is_acknowledged (is_acknowledged),
    INDEX idx_node (node_id),
    INDEX idx_location (location_id),
    INDEX idx_alert_type (alert_type)
);

-- Notification Settings Table
CREATE TABLE notification_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    email_notifications BOOLEAN DEFAULT TRUE,
    push_notifications BOOLEAN DEFAULT TRUE,
    sms_notifications BOOLEAN DEFAULT FALSE,
    low_severity BOOLEAN DEFAULT TRUE,
    medium_severity BOOLEAN DEFAULT TRUE,
    high_severity BOOLEAN DEFAULT TRUE,
    critical_severity BOOLEAN DEFAULT TRUE,
    notification_frequency ENUM('immediate', 'hourly', 'daily') DEFAULT 'immediate',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user (user_id)
);

-- SMS Delivery Logs Table
CREATE TABLE sms_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    alert_id BIGINT NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'MSG91',
    status ENUM('pending', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    severity VARCHAR(20) NULL,
    location_name VARCHAR(100) NULL,
    message TEXT NOT NULL,
    provider_response LONGTEXT NULL,
    error_message TEXT NULL,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
    INDEX idx_sms_logs_alert_id (alert_id),
    INDEX idx_sms_logs_status (status),
    INDEX idx_sms_logs_created_at (created_at)
);

-- Hourly Aggregated Data Table
CREATE TABLE hourly_aggregated_data (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    node_id VARCHAR(50) NOT NULL,
    location_id INT NOT NULL,
    hour_start TIMESTAMP NOT NULL,
    rainfall_total DECIMAL(8, 2) DEFAULT 0,
    rainfall_max DECIMAL(6, 2) DEFAULT 0,
    soil_moisture_avg DECIMAL(5, 2) DEFAULT 0,
    tilt_x_max DECIMAL(5, 2) DEFAULT 0,
    tilt_y_max DECIMAL(5, 2) DEFAULT 0,
    vibration_max DECIMAL(5, 3) DEFAULT 0,
    temperature_avg DECIMAL(5, 2) DEFAULT 0,
    risk_score_avg DECIMAL(5, 2) DEFAULT 0,
    risk_score_max TINYINT UNSIGNED DEFAULT 0,
    risk_level ENUM('normal', 'low', 'medium', 'high', 'critical') DEFAULT 'normal',
    readings_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_node_hour (node_id, hour_start),
    FOREIGN KEY (node_id) REFERENCES sensor_nodes(node_id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    INDEX idx_hour_start (hour_start),
    INDEX idx_location_hour (location_id, hour_start),
    INDEX idx_risk_level (risk_level)
);

-- Daily Aggregated Data Table
CREATE TABLE daily_aggregated_data (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    node_id VARCHAR(50) NOT NULL,
    location_id INT NOT NULL,
    date DATE NOT NULL,
    rainfall_total DECIMAL(10, 2) DEFAULT 0,
    rainfall_max DECIMAL(6, 2) DEFAULT 0,
    soil_moisture_avg DECIMAL(5, 2) DEFAULT 0,
    tilt_max DECIMAL(5, 2) DEFAULT 0,
    vibration_max DECIMAL(5, 3) DEFAULT 0,
    temperature_min DECIMAL(5, 2) DEFAULT 0,
    temperature_max DECIMAL(5, 2) DEFAULT 0,
    risk_score_avg DECIMAL(5, 2) DEFAULT 0,
    risk_score_max TINYINT UNSIGNED DEFAULT 0,
    risk_level ENUM('normal', 'low', 'medium', 'high', 'critical') DEFAULT 'normal',
    readings_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_node_date (node_id, date),
    FOREIGN KEY (node_id) REFERENCES sensor_nodes(node_id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    INDEX idx_date (date),
    INDEX idx_location_date (location_id, date)
);

-- Insert Default Data
-- Default admin user (password: Admin123!)
INSERT INTO users (username, password_hash, full_name, email, mobile_number, role, is_active) 
VALUES ('admin', '$2a$10$SrDllQS4EwkJYmq88XDTfe9OOIk8AEsJi4hyoFTLj2tFTJ9yUQlim', 'System Administrator', 'admin@landslide-ews.com', '919999999999', 'admin', TRUE)
ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash),
    full_name = VALUES(full_name),
    mobile_number = VALUES(mobile_number),
    role = VALUES(role),
    is_active = VALUES(is_active);

-- Default general user for login/registration testing (password: User123!)
INSERT INTO users (username, password_hash, full_name, email, mobile_number, role, is_active)
VALUES ('general_user', '$2a$10$9Z.toRgbEt5nLE2R6eaosesApM.G6lnDa19f5R7jTdRHobR260cqS', 'General User', 'user@landslide-ews.com', '918888888888', 'viewer', TRUE)
ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash),
    full_name = VALUES(full_name),
    mobile_number = VALUES(mobile_number),
    role = VALUES(role),
    is_active = VALUES(is_active);

-- Sample locations
INSERT INTO locations (name, description, latitude, longitude, altitude, region, risk_level) VALUES
('North Slope', 'Primary monitoring site on north-facing slope', 27.7172, 85.3240, 1350.50, 'Kathmandu Valley', 'medium'),
('South Ridge', 'Secondary site with multiple sensors', 27.7000, 85.3100, 1400.75, 'Kathmandu Valley', 'low'),
('East Valley', 'New installation with soil sensors', 27.7100, 85.3400, 1250.25, 'Kathmandu Valley', 'high');

-- Sample sensor nodes
INSERT INTO sensor_nodes (node_id, name, location_id, sensor_type, status, battery_level, firmware_version) VALUES
('NODE-001', 'Upper Slope Node', 1, 'multi', 'online', 85.50, 'v2.1.0'),
('NODE-002', 'Mid Slope Node', 1, 'multi', 'online', 92.30, 'v2.1.0'),
('NODE-003', 'Lower Slope Node', 1, 'multi', 'offline', 45.20, 'v2.0.5'),
('NODE-004', 'South Ridge Master', 2, 'multi', 'online', 78.90, 'v2.1.0'),
('NODE-005', 'East Valley Monitor', 3, 'multi', 'online', 95.60, 'v2.1.0');

-- Default alert rules
INSERT INTO alert_rules (name, description, parameter, operator, threshold_value, severity, duration_minutes) VALUES
('Heavy Rainfall Alert', 'Alert when rainfall exceeds 25mm/hr', 'rainfall', '>', 25.0, 'high', 15),
('Critical Rainfall Alert', 'Alert for very heavy rainfall', 'rainfall', '>', 40.0, 'critical', 10),
('High Soil Moisture', 'Alert when soil moisture exceeds 75%', 'soil_moisture', '>', 75.0, 'medium', 30),
('Slope Movement', 'Alert for significant tilt', 'tilt', '>', 5.0, 'high', 5),
('Earth Movement', 'Alert for high vibration', 'vibration', '>', 3.5, 'critical', 2),
('Low Battery', 'Alert when battery is low', 'battery', '<', 20.0, 'medium', 60);

-- Insert notification settings for default users
INSERT INTO notification_settings (
    user_id,
    email_notifications,
    push_notifications,
    sms_notifications,
    low_severity,
    medium_severity,
    high_severity,
    critical_severity,
    notification_frequency
)
SELECT
    id,
    TRUE,
    TRUE,
    FALSE,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    'immediate'
FROM users
WHERE username IN ('admin', 'general_user')
ON DUPLICATE KEY UPDATE
    email_notifications = VALUES(email_notifications),
    push_notifications = VALUES(push_notifications),
    sms_notifications = VALUES(sms_notifications),
    low_severity = VALUES(low_severity),
    medium_severity = VALUES(medium_severity),
    high_severity = VALUES(high_severity),
    critical_severity = VALUES(critical_severity),
    notification_frequency = VALUES(notification_frequency);
use landslide_ews;
select *from users;
select * from alert_rules;
select* from sensor_nodes;
select *from sensor_data;
