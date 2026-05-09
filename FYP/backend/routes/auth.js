const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { User, Notification } = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

const notificationDefaults = {
  email_notifications: true,
  push_notifications: true,
  sms_notifications: true,
  low_severity: true,
  medium_severity: true,
  high_severity: true,
  critical_severity: true,
  notification_frequency: 'immediate'
};

const normalizeMobileNumber = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/[^\d+]/g, '');
  return normalized || null;
};

const createUserWithNotification = async ({ username, password, full_name, email, mobile_number, role = 'viewer' }) => {
  const user = await User.create({
    username,
    password_hash: password,
    full_name,
    email,
    mobile_number: normalizeMobileNumber(mobile_number),
    role,
    is_active: true
  });

  await Notification.findOrCreate({
    where: { user_id: user.id },
    defaults: {
      user_id: user.id,
      ...notificationDefaults
    }
  });

  return user;
};

// Public signup (general users)
router.post('/signup', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';
    const full_name = (req.body.full_name || '').trim();
    const email = (req.body.email || '').trim();
    const mobile_number = normalizeMobileNumber(req.body.mobile_number);

    if (!username || !password || !full_name || !email || !mobile_number) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, full name, email, and mobile number are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    const existingUser = await User.findOne({
      where: {
        [Op.or]: [{ username }, { email }, { mobile_number }]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Username, email, or mobile number already exists'
      });
    }

    const user = await createUserWithNotification({
      username,
      password,
      full_name,
      email,
      mobile_number,
      role: 'viewer'
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'landslide-ews-secret',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register user'
    });
  }
});

// Register new user (admin only)
router.post('/register', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, email, role = 'viewer' } = req.body;
    const mobile_number = normalizeMobileNumber(req.body.mobile_number);

    if (!username || !password || !full_name || !email || !mobile_number) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, full name, email, and mobile number are required'
      });
    }

    const existingUser = await User.findOne({
      where: {
        [Op.or]: [
          { username },
          { email },
          ...(mobile_number ? [{ mobile_number }] : [])
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Username, email, or mobile number already exists'
      });
    }

    const user = await createUserWithNotification({
      username,
      password,
      full_name,
      email,
      mobile_number,
      role
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'landslide-ews-secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'User registered successfully',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register user'
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const password = req.body.password || '';
    const identifier = String(
      req.body.identifier || req.body.username || req.body.email || req.body.mobile_number || ''
    ).trim();

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'Login identifier and password are required'
      });
    }

    const user = await User.findOne({
      where: {
        is_active: true,
        [Op.or]: [
          { username: identifier },
          { email: identifier },
          { mobile_number: normalizeMobileNumber(identifier) || identifier }
        ]
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const isValidPassword = await user.verifyPassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    user.last_login = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'landslide-ews-secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// Get current user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { full_name, email } = req.body;
    const mobile_number = req.body.mobile_number !== undefined
      ? normalizeMobileNumber(req.body.mobile_number)
      : undefined;

    const user = await User.findByPk(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (email && email !== user.email) {
      const existingEmailUser = await User.findOne({
        where: {
          email,
          id: { [Op.ne]: user.id }
        }
      });

      if (existingEmailUser) {
        return res.status(400).json({
          success: false,
          error: 'Email already in use'
        });
      }
    }

    if (mobile_number !== undefined && mobile_number !== user.mobile_number) {
      const existingMobileUser = await User.findOne({
        where: {
          mobile_number,
          id: { [Op.ne]: user.id }
        }
      });

      if (existingMobileUser) {
        return res.status(400).json({
          success: false,
          error: 'Mobile number already in use'
        });
      }
    }

    user.full_name = full_name || user.full_name;
    user.email = email || user.email;
    if (mobile_number !== undefined) {
      user.mobile_number = mobile_number;
    }

    if (req.body.password) {
      user.password_hash = req.body.password;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

// Get current user's notification settings
router.get('/notification-settings', authMiddleware, async (req, res) => {
  try {
    const [settings] = await Notification.findOrCreate({
      where: { user_id: req.userId },
      defaults: {
        user_id: req.userId,
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

    res.json({
      success: true,
      settings: settings.toJSON()
    });
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification settings'
    });
  }
});

// Update current user's notification settings
router.put('/notification-settings', authMiddleware, async (req, res) => {
  try {
    const allowedFrequencies = ['immediate', 'hourly', 'daily'];
    const updates = {};
    const booleanFields = [
      'email_notifications',
      'push_notifications',
      'sms_notifications',
      'low_severity',
      'medium_severity',
      'high_severity',
      'critical_severity'
    ];

    booleanFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = Boolean(req.body[field]);
      }
    });

    if (req.body.notification_frequency !== undefined) {
      if (!allowedFrequencies.includes(req.body.notification_frequency)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid notification_frequency value'
        });
      }
      updates.notification_frequency = req.body.notification_frequency;
    }

    const [settings] = await Notification.findOrCreate({
      where: { user_id: req.userId },
      defaults: {
        user_id: req.userId,
        ...updates
      }
    });

    if (Object.keys(updates).length > 0) {
      await settings.update(updates);
    }

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      settings: settings.toJSON()
    });
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notification settings'
    });
  }
});

// Admin: Get all users
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

module.exports = router;
