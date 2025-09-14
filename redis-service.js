const { createClient } = require('redis');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.redisHost = process.env.REDIS_HOST || 'localhost';
    this.redisPort = process.env.REDIS_PORT || 6379;
    this.redisPassword = process.env.REDIS_PASSWORD || null;
    this.redisDb = process.env.REDIS_DB || 0;
    this.isCluster = process.env.REDIS_CLUSTER === 'true' || false;
    
    // Configuration
    this.config = {
      maxLocationEntries: 100, // Keep only latest 100 entries per user
      locationTTL: 7 * 24 * 60 * 60, // 7 days TTL for location data
      userTTL: 30 * 24 * 60 * 60, // 30 days TTL for user metadata
      keyPrefix: 'location_share:'
    };
  }

  async connect() {
    try {
      const redisUrl = this.redisPassword 
        ? `redis://:${this.redisPassword}@${this.redisHost}:${this.redisPort}/${this.redisDb}`
        : `redis://${this.redisHost}:${this.redisPort}/${this.redisDb}`;

      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('Redis connection failed after 10 retries');
              return new Error('Redis connection failed');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        console.log('Redis client ready');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        console.log('Redis client disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      console.log(`✅ Connected to Redis at ${this.redisHost}:${this.redisPort}`);
      
      return true;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isConnected = false;
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        console.log('Redis client disconnected gracefully');
      } catch (error) {
        console.error('Error disconnecting from Redis:', error);
      }
    }
  }

  // Store user location with timestamp as score in ZSET
  async storeUserLocation(username, locationData) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping location storage');
      return false;
    }

    try {
      const timestamp = Date.now();
      const locationKey = `${this.config.keyPrefix}locations:${username}`;
      const userKey = `${this.config.keyPrefix}user:${username}`;
      
      // Store location data in ZSET with timestamp as score
      const locationEntry = JSON.stringify({
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        name: locationData.name,
        lastUpdate: locationData.lastUpdate || new Date().toISOString()
      });

      // Add to ZSET
      await this.client.zAdd(locationKey, {
        score: timestamp,
        value: locationEntry
      });

      // Keep only latest 100 entries
      await this.client.zRemRangeByRank(locationKey, 0, -this.config.maxLocationEntries - 1);

      // Set TTL for location data
      await this.client.expire(locationKey, this.config.locationTTL);

      // Store user metadata
      await this.client.hSet(userKey, {
        name: locationData.name,
        lastUpdate: locationData.lastUpdate || new Date().toISOString()
      });

      // Set TTL for user metadata
      await this.client.expire(userKey, this.config.userTTL);

      console.log(`📍 Stored location for user ${username} at ${new Date(timestamp).toISOString()}`);
      return true;
    } catch (error) {
      console.error('Error storing user location:', error);
      return false;
    }
  }

  // Get latest location for a user
  async getLatestUserLocation(username) {
    if (!this.isConnected) {
      console.warn('Redis not connected, cannot retrieve location');
      return null;
    }

    try {
      const locationKey = `${this.config.keyPrefix}locations:${username}`;
      const userKey = `${this.config.keyPrefix}user:${username}`;

      // Get the latest location from ZSET (highest score = latest)
      const latestLocation = await this.client.zRange(locationKey, -1, -1, { REV: true });
      
      if (latestLocation.length === 0) {
        return null;
      }

      const locationData = JSON.parse(latestLocation[0]);
      
      // Get user metadata
      const userMetadata = await this.client.hGetAll(userKey);
      
      return {
        ...locationData,
        ...userMetadata
      };
    } catch (error) {
      console.error('Error retrieving user location:', error);
      return null;
    }
  }

  // Get location history for a user (with time range)
  async getUserLocationHistory(username, startTime = null, endTime = null) {
    if (!this.isConnected) {
      console.warn('Redis not connected, cannot retrieve location history');
      return [];
    }

    try {
      const locationKey = `${this.config.keyPrefix}locations:${username}`;
      
      let options = { REV: true }; // Get in reverse order (latest first)
      
      if (startTime && endTime) {
        options.BYSCORE = true;
        options.MIN = startTime;
        options.MAX = endTime;
      }

      const locations = await this.client.zRange(locationKey, 0, -1, options);
      
      return locations.map(location => {
        const data = JSON.parse(location);
        return {
          ...data
        };
      });
    } catch (error) {
      console.error('Error retrieving location history:', error);
      return [];
    }
  }

  // Get all users with their latest locations
  async getAllUsersWithLocations() {
    if (!this.isConnected) {
      console.warn('Redis not connected, cannot retrieve users');
      return [];
    }

    try {
      // Look for location keys instead of user keys to avoid duplicates
      const pattern = `${this.config.keyPrefix}locations:*`;
      const locationKeys = await this.client.keys(pattern);
      
      const users = [];
      
      for (const locationKey of locationKeys) {
        const username = locationKey.replace(`${this.config.keyPrefix}locations:`, '');
        const userData = await this.getLatestUserLocation(username);
        
        if (userData) {
          users.push(userData);
        }
      }
      
      return users;
    } catch (error) {
      console.error('Error retrieving all users:', error);
      return [];
    }
  }

  // Remove user data
  async removeUser(username) {
    if (!this.isConnected) {
      console.warn('Redis not connected, cannot remove user');
      return false;
    }

    try {
      const locationKey = `${this.config.keyPrefix}locations:${username}`;
      const userKey = `${this.config.keyPrefix}user:${username}`;

      await this.client.del(locationKey);
      await this.client.del(userKey);
      
      console.log(`🗑️ Removed user data for ${username}`);
      return true;
    } catch (error) {
      console.error('Error removing user:', error);
      return false;
    }
  }

  // Check if user exists
  async userExists(username) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const userKey = `${this.config.keyPrefix}user:${username}`;
      const exists = await this.client.exists(userKey);
      return exists === 1;
    } catch (error) {
      console.error('Error checking user existence:', error);
      return false;
    }
  }

  // Get Redis connection status
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      host: this.redisHost,
      port: this.redisPort
    };
  }

  // Clean up old entries (can be called periodically)
  async cleanupOldEntries() {
    if (!this.isConnected) {
      return;
    }

    try {
      const pattern = `${this.config.keyPrefix}locations:*`;
      const locationKeys = await this.client.keys(pattern);
      
      const now = Date.now();
      const cutoffTime = now - (this.config.locationTTL * 1000);
      
      for (const key of locationKeys) {
        // Remove entries older than TTL
        await this.client.zRemRangeByScore(key, 0, cutoffTime);
      }
      
      console.log(`🧹 Cleaned up old location entries`);
    } catch (error) {
      console.error('Error cleaning up old entries:', error);
    }
  }
}

module.exports = RedisService;
