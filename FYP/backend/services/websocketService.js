const jwt = require('jsonwebtoken');
const { User } = require('../models');

class WebSocketService {
  constructor() {
    this.io = null;
    this.connections = new Map(); // Map to track connections
  }

  isAdminOnlyAlert(alert) {
    return String(alert?.alert_type || '').startsWith('sensor_health_');
  }

  init(io) {
    this.io = io;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (token === 'guest') {
          socket.user = { id: null, username: 'guest', role: 'visitor' };
          return next();
        }
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'landslide-ews-secret');
        const user = await User.findByPk(decoded.userId);
        
        if (!user) {
          return next(new Error('Authentication error: User not found'));
        }

        socket.user = user.toJSON();
        next();
      } catch (error) {
        console.error('WebSocket authentication error:', error.message);
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`🔌 New WebSocket connection: ${socket.id} (User: ${socket.user.username})`);
      
      // Store connection
      this.connections.set(socket.id, {
        socket,
        user: socket.user,
        joinedRooms: new Set()
      });

      // Send current connection count
      this.broadcastConnectionCount();

      if (socket.user.role === 'admin') {
        socket.join('admin');
      }

      // Join location room
      socket.on('join-location', (locationId) => {
        const roomName = `location:${locationId}`;
        socket.join(roomName);
        const conn = this.connections.get(socket.id);
        if (conn) conn.joinedRooms.add(roomName);
        console.log(`📍 Socket ${socket.id} joined room ${roomName}`);
      });

      // Leave location room
      socket.on('leave-location', (locationId) => {
        const roomName = `location:${locationId}`;
        socket.leave(roomName);
        const conn = this.connections.get(socket.id);
        if (conn) conn.joinedRooms.delete(roomName);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`🔌 WebSocket disconnected: ${socket.id}`);
        this.connections.delete(socket.id);
        this.broadcastConnectionCount();
      });

      // Ping-pong for connection health
      socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
          callback('pong');
        }
      });
    });
  }

  // Broadcast sensor update to relevant rooms
  broadcastSensorUpdate(sensorData) {
    const roomName = `location:${sensorData.location_id}`;
    this.io.to(roomName).emit('sensor-update', {
      ...sensorData.toJSON(),
      timestamp: new Date().toISOString()
    });

    // Broadcast risk update if risk level changed
    this.io.to(roomName).emit('risk-update', {
      risk_score: sensorData.risk_score,
      risk_level: sensorData.risk_level,
      node_id: sensorData.node_id,
      location_id: sensorData.location_id,
      timestamp: sensorData.reading_timestamp
    });
  }

  // Broadcast new alerts
  broadcastNewAlerts(alerts) {
    alerts.forEach(alert => {
      const roomName = `location:${alert.location_id}`;
      const payload = alert.toJSON();
      const adminOnly = this.isAdminOnlyAlert(payload);

      this.connections.forEach((conn) => {
        if (!conn.joinedRooms.has(roomName)) {
          return;
        }

        if (adminOnly && conn.user.role !== 'admin') {
          return;
        }

        conn.socket.emit('new-alert', payload);
      });
    });
    
    // Also broadcast to admin room
    this.io.to('admin').emit('new-alerts', alerts.map(a => a.toJSON()));
  }

  // Broadcast node status update
  broadcastNodeStatusUpdate(nodeData) {
    const roomName = `location:${nodeData.location_id}`;
    this.io.to(roomName).emit('node-status-update', nodeData);
  }

  // Broadcast connection count
  broadcastConnectionCount() {
    this.io.emit('connections-update', {
      count: this.connections.size,
      timestamp: new Date().toISOString()
    });
  }

  // Get connection stats
  getConnectionStats() {
    const stats = {
      total: this.connections.size,
      byRole: {},
      byLocation: {}
    };

    this.connections.forEach(conn => {
      // Count by role
      const role = conn.user.role;
      stats.byRole[role] = (stats.byRole[role] || 0) + 1;

      // Count by location (simplified - assumes each connection is in one location room)
      conn.joinedRooms.forEach(room => {
        if (room.startsWith('location:')) {
          const locationId = room.split(':')[1];
          stats.byLocation[locationId] = (stats.byLocation[locationId] || 0) + 1;
        }
      });
    });

    return stats;
  }
}

module.exports = new WebSocketService();
