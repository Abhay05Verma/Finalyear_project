const jwt = require('jsonwebtoken');
const { User } = require('../models');

// Set DISABLE_AUTH=true only for local debugging in isolated environments.
const DISABLE_AUTH = process.env.DISABLE_AUTH === 'true';

const authMiddleware = async (req, res, next) => {
  if (DISABLE_AUTH) {
    req.user = {
      id: 1,
      role: 'admin',
      username: 'demo'
    };
    req.userId = 1;
    req.userRole = 'admin';
    return next();
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided or invalid format'
      });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'landslide-ews-secret'
    );

    const user = await User.findByPk(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'User account is deactivated'
      });
    }

    req.user = user.toJSON();
    req.userId = user.id;
    req.userRole = user.role;

    next();
  } catch (error) {
    console.error('Authentication error:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (DISABLE_AUTH) {
      return next();
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
};

module.exports = {
  authMiddleware,
  requireRole
};