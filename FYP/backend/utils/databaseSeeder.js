require('dotenv').config();
const { sequelize, User, Location, SensorNode, AlertRule, Notification } = require('../models');

async function seedDatabase() {
  try {
    console.log('Starting database seeding...');

    await sequelize.sync({ force: false });
    console.log('Database synchronized');

    // Ensure admin user exists and default credentials are valid.
    const adminUser = await User.findOne({ where: { username: 'admin' } });
    if (!adminUser) {
      const createdAdmin = await User.create({
        username: 'admin',
        password_hash: 'Admin123!',
        full_name: 'System Administrator',
        email: 'admin@landslide-ews.com',
        role: 'admin',
        is_active: true
      });
      await Notification.findOrCreate({
        where: { user_id: createdAdmin.id },
        defaults: {
          user_id: createdAdmin.id,
          email_notifications: true,
          push_notifications: true,
          sms_notifications: true,
          low_severity: true,
          medium_severity: true,
          high_severity: true,
          critical_severity: true,
          notification_frequency: 'immediate'
        }
      });
      console.log('Admin user created (username: admin, password: Admin123!)');
    } else {
      const validDefault = await adminUser.verifyPassword('Admin123!');
      if (!validDefault) {
        adminUser.password_hash = 'Admin123!';
        adminUser.is_active = true;
        await adminUser.save();
        console.log('Admin password reset to default (username: admin, password: Admin123!)');
      }
      await Notification.findOrCreate({
        where: { user_id: adminUser.id },
        defaults: {
          user_id: adminUser.id,
          email_notifications: true,
          push_notifications: true,
          sms_notifications: true,
          low_severity: true,
          medium_severity: true,
          high_severity: true,
          critical_severity: true,
          notification_frequency: 'immediate'
        }
      });
    }

    const locations = [
      {
        name: 'North Slope',
        description: 'Primary monitoring site on north-facing slope',
        latitude: 27.7172,
        longitude: 85.324,
        altitude: 1350.5,
        region: 'IrshalwadiMaharashtra',
        risk_level: 'medium',
        is_active: true
      },
      {
        name: 'South Ridge',
        description: 'Secondary site with multiple sensors',
        latitude: 27.7,
        longitude: 85.31,
        altitude: 1400.75,
        region: 'Raigad district',
        risk_level: 'low',
        is_active: true
      },
      {
        name: 'East Valley',
        description: 'New installation with soil sensors',
        latitude: 27.71,
        longitude: 85.34,
        altitude: 1250.25,
        region: 'Maharashtra',
        risk_level: 'high',
        is_active: true
      },
      {
        name: 'Munnar Hills',
        description: 'Western Ghats tea-hill slope monitoring site',
        latitude: 10.0889,
        longitude: 77.0595,
        altitude: 1532.0,
        region: 'Western Ghats',
        risk_level: 'medium',
        is_active: true
      },
      {
        name: 'Coorg Ridge',
        description: 'Western Ghats high-rainfall zone in Kodagu',
        latitude: 12.3375,
        longitude: 75.8069,
        altitude: 1175.0,
        region: 'Western Ghats',
        risk_level: 'high',
        is_active: true
      },
      {
        name: 'Wayanad Escarpment',
        description: 'Landslide-prone escarpment in the Western Ghats',
        latitude: 11.6854,
        longitude: 76.1320,
        altitude: 900.0,
        region: 'Western Ghats',
        risk_level: 'high',
        is_active: true
      },
      {
        name: 'Joshimath Slope',
        description: 'Himalayan settlement slope stability monitoring site',
        latitude: 30.5552,
        longitude: 79.5647,
        altitude: 1875.0,
        region: 'Himalayan Region',
        risk_level: 'high',
        is_active: true
      },
      {
        name: 'Darjeeling Hills',
        description: 'Himalayan hill-slope monitoring in high rainfall terrain',
        latitude: 27.0360,
        longitude: 88.2627,
        altitude: 2042.0,
        region: 'Himalayan Region',
        risk_level: 'medium',
        is_active: true
      },
      {
        name: 'Kullu Valley Rim',
        description: 'Himalayan valley-edge monitoring location',
        latitude: 31.9579,
        longitude: 77.1095,
        altitude: 1279.0,
        region: 'Himalayan Region',
        risk_level: 'medium',
        is_active: true
      }
    ];

    for (const locationData of locations) {
      const [location] = await Location.findOrCreate({
        where: { name: locationData.name },
        defaults: locationData
      });
      console.log(`Location created/updated: ${location.name}`);
    }

    const sensorNodes = [
      {
        node_id: 'NODE-001',
        name: 'Irshalwadi, Raigad district, Maharashtra',
        location_id: 1,
        sensor_type: 'multi',
        status: 'online',
        battery_level: 85.5,
        firmware_version: 'v2.1.0',
        installation_date: '2024-01-15'
      },
      {
        node_id: 'NODE-002',
        name: 'Mid Slope Node',
        location_id: 1,
        sensor_type: 'multi',
        status: 'online',
        battery_level: 92.3,
        firmware_version: 'v2.1.0',
        installation_date: '2024-01-15'
      }
    ];

    for (const nodeData of sensorNodes) {
      const [node] = await SensorNode.findOrCreate({
        where: { node_id: nodeData.node_id },
        defaults: nodeData
      });
      console.log(`Sensor node created/updated: ${node.name} (${node.node_id})`);
    }

    const alertRules = [
      {
        name: 'Heavy Rainfall Alert',
        description: 'Alert when rainfall exceeds 25mm/hr',
        parameter: 'rainfall',
        operator: '>',
        threshold_value: 25.0,
        severity: 'high',
        duration_minutes: 15,
        is_active: true
      },
      {
        name: 'Critical Rainfall Alert',
        description: 'Alert for very heavy rainfall',
        parameter: 'rainfall',
        operator: '>',
        threshold_value: 40.0,
        severity: 'critical',
        duration_minutes: 10,
        is_active: true
      },
      {
        name: 'High Soil Moisture',
        description: 'Alert when soil moisture exceeds 75%',
        parameter: 'soil_moisture',
        operator: '>',
        threshold_value: 75.0,
        severity: 'medium',
        duration_minutes: 30,
        is_active: true
      },
      {
        name: 'Slope Movement',
        description: 'Alert for significant tilt',
        parameter: 'tilt',
        operator: '>',
        threshold_value: 5.0,
        severity: 'high',
        duration_minutes: 5,
        is_active: true
      },
      {
        name: 'Earth Movement',
        description: 'Alert for high vibration',
        parameter: 'vibration',
        operator: '>',
        threshold_value: 3.5,
        severity: 'critical',
        duration_minutes: 2,
        is_active: true
      },
      {
        name: 'Low Battery',
        description: 'Alert when battery is low',
        parameter: 'battery',
        operator: '<',
        threshold_value: 20.0,
        severity: 'medium',
        duration_minutes: 60,
        is_active: true
      }
    ];

    for (const ruleData of alertRules) {
      const [rule] = await AlertRule.findOrCreate({
        where: { name: ruleData.name },
        defaults: ruleData
      });
      console.log(`Alert rule created/updated: ${rule.name}`);
    }

    console.log('Database seeding completed successfully');
    console.log('Admin user: admin / Admin123!');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();
