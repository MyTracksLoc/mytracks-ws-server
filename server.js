const uWS = require('uWebSockets.js');
const RedisService = require('./redis-service');

class LocationServer {
  constructor(port = 8083) {
    this.port = port;
    this.users = new Map(); // username -> user data (in-memory cache)
    this.connections = new Map(); // username -> websocket connection
    this.userRateLimit = new Map(); // username -> last update timestamp
    this.serverId = `server-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize Redis service
    this.redis = new RedisService();
    
    // Configuration
    this.config = {
      maxUsers: 100,
      locationUpdateInterval: 2000, // minimum 2 seconds between updates
      userTimeout: 30000, // 30 seconds timeout for stale data
      maxNameLength: 50
    };

    this.app = uWS.App({
      compression: uWS.SHARED_COMPRESSOR,
      maxCompressedSize: 64 * 1024,
      maxBackpressure: 64 * 1024
    });

    this.setupRoutes();
    this.startCleanupTimer();
    this.initializeRedis();
  }

  async initializeRedis() {
    console.log('🔄 Initializing Redis connection...');
    
    // Set default Redis connection for Docker if not specified
    if (!process.env.REDIS_HOST) {
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6384';
      console.log('📡 Using default Redis connection: localhost:6384');
    }
    
    const connected = await this.redis.connect();
    if (connected) {
      console.log('✅ Redis initialized successfully');
      // Load existing users from Redis on startup
      await this.loadUsersFromRedis();
    } else {
      console.warn('⚠️ Redis connection failed, running in memory-only mode');
    }
  }

  async loadUsersFromRedis() {
    try {
      const users = await this.redis.getAllUsersWithLocations();
      console.log(`📊 Loaded ${users.length} users from Redis`);
      
      // Add users to in-memory cache (but don't set connections)
      users.forEach(user => {
        this.users.set(user.name, user);
      });
    } catch (error) {
      console.error('Error loading users from Redis:', error);
    }
  }

  setupRoutes() {
    this.app.ws('/*', {
      compression: uWS.OPCODE_BINARY,
      maxCompressedSize: 64 * 1024,
      maxBackpressure: 64 * 1024,
      
      open: (ws) => {
        console.log('New WebSocket connection opened');
        ws.username = null; // Will be set when user sends location_update
        
        // Send connection acknowledgment
        this.sendMessage(ws, {
          type: 'connected',
          data: {
            message: 'Successfully connected to location sharing service',
            serverId: this.serverId,
            timestamp: new Date().toISOString()
          }
        });

        // Send current users list
        this.sendUsersList(ws);
      },

      message: (ws, message, opCode) => {
        try {
          const data = JSON.parse(Buffer.from(message).toString());
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('Invalid JSON received:', error.message);
          this.sendError(ws, 'INVALID_JSON', 'Invalid JSON format', error.message);
        }
      },

      close: (ws) => {
        console.log('WebSocket connection closed');
        if (ws.username) {
          this.handleUserDisconnect(ws.username);
        }
      }
    });

    // Health check endpoint
    this.app.get('/health', (res) => {
      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'healthy',
        connectedUsers: this.users.size,
        serverId: this.serverId,
        redis: this.redis.getConnectionStatus(),
        timestamp: new Date().toISOString()
      }));
    });
  }

  handleMessage(ws, message) {
    if (!message.type || !message.data) {
      return this.sendError(ws, 'INVALID_MESSAGE', 'Message must have type and data fields');
    }

    switch (message.type) {
      case 'location_update':
        this.handleLocationUpdate(ws, message.data).catch(error => {
          console.error('Error handling location update:', error);
          this.sendError(ws, 'LOCATION_UPDATE_ERROR', 'Failed to process location update', error.message);
        });
        break;
      
      case 'user_disconnect':
        this.handleUserDisconnectRequest(ws, message.data);
        break;
      
      case 'get_users':
        this.sendUsersList(ws).catch(error => {
          console.error('Error sending users list:', error);
          this.sendError(ws, 'USERS_LIST_ERROR', 'Failed to retrieve users list', error.message);
        });
        break;
      
      case 'get_location_history':
        this.handleLocationHistoryRequest(ws, message.data).catch(error => {
          console.error('Error handling location history request:', error);
          this.sendError(ws, 'HISTORY_REQUEST_ERROR', 'Failed to process location history request', error.message);
        });
        break;
      
      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
    }
  }

  async handleLocationUpdate(ws, data) {
    // Validate required fields
    const validation = this.validateLocationData(data);
    if (!validation.valid) {
      return this.sendError(ws, validation.code, validation.message, validation.details);
    }

    // Check rate limiting
    if (this.isRateLimited(data.name)) {
      return this.sendError(ws, 'RATE_LIMITED', 'Location updates too frequent', 
        `Minimum interval is ${this.config.locationUpdateInterval}ms`);
    }

    // Check user limit
    if (!this.users.has(data.name) && this.users.size >= this.config.maxUsers) {
      return this.sendError(ws, 'USER_LIMIT_EXCEEDED', 
        `Maximum ${this.config.maxUsers} users allowed`);
    }

    // Update rate limit tracker
    this.userRateLimit.set(data.name, Date.now());

    // Store/update user data
    const userData = {
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      lastUpdate: data.lastUpdate || new Date().toISOString()
    };

    const isNewUser = !this.users.has(data.name);
    this.users.set(data.name, userData);
    this.connections.set(data.name, ws);
    ws.username = data.name;

    // Store in Redis for persistence
    await this.redis.storeUserLocation(data.name, userData);

    console.log(`${isNewUser ? 'New' : 'Updated'} user location:`, userData);

    // Broadcast to all other connected clients
    this.broadcastToOthers(data.name, {
      type: 'user_location',
      data: userData
    });
  }

  handleUserDisconnectRequest(ws, data) {
    if (!data.name) {
      return this.sendError(ws, 'INVALID_DISCONNECT', 'Username required for disconnect');
    }

    if (ws.username === data.name) {
      this.handleUserDisconnect(data.name);
      ws.close();
    } else {
      this.sendError(ws, 'UNAUTHORIZED_DISCONNECT', 'Can only disconnect your own session');
    }
  }

  async handleUserDisconnect(username) {
    const user = this.users.get(username);
    if (user) {
      console.log('User disconnected:', user);
      
      // Remove from in-memory storage
      this.users.delete(username);
      this.connections.delete(username);
      this.userRateLimit.delete(username);

      // Note: We don't remove from Redis on disconnect to maintain persistence
      // The TTL will handle cleanup of old data

      // Notify all other clients
      // this.broadcastToAll({
      //   type: 'user_disconnected',
      //   data: {
      //     name: user.name
      //   }
      // });
    }
  }

  validateLocationData(data) {
    // Check required fields
    if (!data.name || typeof data.name !== 'string') {
      return { valid: false, code: 'INVALID_NAME', message: 'Name is required and must be a string' };
    }

    if (data.name.length === 0 || data.name.length > this.config.maxNameLength) {
      return { 
        valid: false, 
        code: 'INVALID_NAME', 
        message: 'Name must be between 1 and 50 characters',
        details: `Name length: ${data.name.length}, max: ${this.config.maxNameLength}`
      };
    }

    if (typeof data.latitude !== 'number' || data.latitude < -90 || data.latitude > 90) {
      return { 
        valid: false, 
        code: 'INVALID_LOCATION', 
        message: 'Invalid latitude value',
        details: 'Latitude must be between -90 and 90'
      };
    }

    if (typeof data.longitude !== 'number' || data.longitude < -180 || data.longitude > 180) {
      return { 
        valid: false, 
        code: 'INVALID_LOCATION', 
        message: 'Invalid longitude value',
        details: 'Longitude must be between -180 and 180'
      };
    }

    // Check if location update is too old (optional validation)
    if (data.lastUpdate) {
      const updateTime = new Date(data.lastUpdate).getTime();
      const now = Date.now();
      if (now - updateTime > this.config.userTimeout) {
        return {
          valid: false,
          code: 'STALE_LOCATION',
          message: 'Location update is too old',
          details: `Update is ${Math.floor((now - updateTime) / 1000)} seconds old`
        };
      }
    }

    return { valid: true };
  }

  isRateLimited(username) {
    const lastUpdate = this.userRateLimit.get(username);
    if (!lastUpdate) return false;
    
    return (Date.now() - lastUpdate) < this.config.locationUpdateInterval;
  }

  async sendUsersList(ws) {
    try {
      // Get all users from Redis (including disconnected ones)
      const allUsers = await this.redis.getAllUsersWithLocations();
      
      // Merge with in-memory users (connected ones)
      const connectedUsers = Array.from(this.users.values());
      const connectedUsernames = new Set(connectedUsers.map(u => u.name));
      
      // Add connection status to users
      const usersWithStatus = allUsers.map(user => ({
        ...user,
        connected: connectedUsernames.has(user.name)
      }));
      
      this.sendMessage(ws, {
        type: 'users_list',
        data: usersWithStatus
      });
    } catch (error) {
      console.error('Error sending users list:', error);
      // Fallback to in-memory users only
      const usersList = Array.from(this.users.values());
      this.sendMessage(ws, {
        type: 'users_list',
        data: usersList
      });
    }
  }

  async handleLocationHistoryRequest(ws, data) {
    if (!data || !data.username) {
      return this.sendError(ws, 'MISSING_USERNAME', 'Username is required for location history');
    }

    try {
      const startTime = data.startTime ? new Date(data.startTime).getTime() : null;
      const endTime = data.endTime ? new Date(data.endTime).getTime() : null;
      
      const history = await this.redis.getUserLocationHistory(data.username, startTime, endTime);
      
      this.sendMessage(ws, {
        type: 'location_history',
        data: {
          username: data.username,
          history: history
        }
      });
    } catch (error) {
      console.error('Error retrieving location history:', error);
      this.sendError(ws, 'HISTORY_ERROR', 'Failed to retrieve location history', error.message);
    }
  }

  sendMessage(ws, message) {
    try {
      if (ws.readyState === uWS.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  sendError(ws, code, message, details = null) {
    this.sendMessage(ws, {
      type: 'error',
      data: {
        code,
        message,
        ...(details && { details })
      }
    });
  }

  broadcastToOthers(excludeUsername, message) {
    this.connections.forEach((ws, username) => {
      if (username !== excludeUsername) {
        this.sendMessage(ws, message);
      }
    });
  }

  broadcastToAll(message) {
    this.connections.forEach((ws) => {
      this.sendMessage(ws, message);
    });
  }

  startCleanupTimer() {
    // Clean up stale user data every 30 seconds
    setInterval(async () => {
      const now = Date.now();
      const staleUsers = [];

      this.users.forEach((user, username) => {
        const lastUpdate = new Date(user.lastUpdate).getTime();
        if (now - lastUpdate > this.config.userTimeout) {
          staleUsers.push(username);
        }
      });

      for (const username of staleUsers) {
        console.log('Cleaning up stale user:', username);
        await this.handleUserDisconnect(username);
      }

      if (staleUsers.length > 0) {
        console.log(`Cleaned up ${staleUsers.length} stale user(s)`);
      }

      // Clean up old Redis entries
      await this.redis.cleanupOldEntries();
    }, 30000);
  }

  start() {
    console.log(`🔄 Attempting to start server on port ${this.port}...`);
    console.log(`🖥️  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 Binding to: 0.0.0.0:${this.port}`);
    
    this.app.listen('0.0.0.0', this.port, (token) => {
      if (token) {
        console.log(`🚀 Live Location WebSocket Server started successfully!`);
        console.log(`📊 Server ID: ${this.serverId}`);
        console.log(`🌐 Address: 0.0.0.0:${this.port}`);
        console.log(`👥 Max users: ${this.config.maxUsers}`);
        console.log(`⏱️  Rate limit: ${this.config.locationUpdateInterval}ms`);
        console.log(`🔗 Health check: http://localhost:${this.port}/health`);
        console.log(`📝 WebSocket URL: ws://localhost:${this.port}`);
      } else {
        console.error(`❌ Failed to listen on port ${this.port}`);
        console.error(`🔍 Possible causes:`);
        console.error(`   - Port ${this.port} is already in use`);
        console.error(`   - Permission denied (ports < 1024 require root)`);
        console.error(`   - Invalid port number`);
        console.error(`   - Network interface not available`);
        console.error(`🛠️  Try: lsof -i :${this.port} (to check what's using the port)`);
        process.exit(1);
      }
    });
  }

  // Graceful shutdown
  async shutdown() {
    console.log('🛑 Shutting down server...');
    
    // Notify all users about server shutdown
    this.broadcastToAll({
      type: 'error',
      data: {
        code: 'SERVER_SHUTDOWN',
        message: 'Server is shutting down'
      }
    });

    // Close all connections
    this.connections.forEach((ws) => {
      ws.close();
    });

    // Clear data
    this.users.clear();
    this.connections.clear();
    this.userRateLimit.clear();

    // Close Redis connection
    await this.redis.disconnect();

    console.log('✅ Server shutdown complete');
    process.exit(0);
  }
}

// Create and start server
const server = new LocationServer(process.env.PORT || 8083);
server.start();

// Handle graceful shutdown
process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

module.exports = LocationServer;