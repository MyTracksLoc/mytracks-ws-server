const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class TestClient {
  constructor(url = 'ws://localhost:8083', userName = 'Test User') {
    this.url = url;
    this.userId = uuidv4();
    this.userName = userName;
    this.ws = null;
    this.locationUpdateInterval = null;
    
    // Starting location (San Francisco)
    this.location = {
      latitude: 37.7749 + (Math.random() - 0.5) * 0.01, // Add some randomness
      longitude: -122.4194 + (Math.random() - 0.5) * 0.01
    };
  }

  connect() {
    console.log(`🔗 Connecting to ${this.url} as ${this.userName} (${this.userId})`);
    
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      console.log('✅ Connected to WebSocket server');
      this.startLocationUpdates();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error('❌ Error parsing message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('🔌 Connection closed');
      this.stopLocationUpdates();
    });

    this.ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'connected':
        console.log('📡 Server connection acknowledged:', message.data.message);
        break;
      
      case 'users_list':
        console.log(`👥 Current users (${message.data.length}):`);
        message.data.forEach(user => {
          console.log(`   - ${user.name} (${user.id.substr(0, 8)}...) at [${user.latitude}, ${user.longitude}]`);
        });
        break;
      
      case 'user_location':
        const user = message.data;
        console.log(`📍 ${user.name} moved to [${user.latitude}, ${user.longitude}] at ${user.lastUpdate}`);
        break;
      
      case 'user_disconnected':
        console.log(`👋 ${message.data.name || message.data.id} disconnected`);
        break;
      
      case 'error':
        console.error(`❌ Server error [${message.data.code}]: ${message.data.message}`);
        if (message.data.details) {
          console.error(`   Details: ${message.data.details}`);
        }
        break;
      
      default:
        console.log('📨 Received message:', message);
    }
  }

  startLocationUpdates() {
    // Send initial location
    this.sendLocationUpdate();

    // Send location updates every 5 seconds
    this.locationUpdateInterval = setInterval(() => {
      // Simulate movement (small random changes)
      this.location.latitude += (Math.random() - 0.5) * 0.001;
      this.location.longitude += (Math.random() - 0.5) * 0.001;
      
      this.sendLocationUpdate();
    }, 5000);
  }

  sendLocationUpdate() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'location_update',
        data: {
          id: this.userId,
          name: this.userName,
          latitude: this.location.latitude,
          longitude: this.location.longitude,
          lastUpdate: new Date().toISOString()
        }
      };

      this.ws.send(JSON.stringify(message));
      console.log(`📤 Sent location: [${this.location.latitude.toFixed(4)}, ${this.location.longitude.toFixed(4)}]`);
    }
  }

  requestUsersList() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'get_users',
        data: {}
      }));
    }
  }

  disconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send explicit disconnect message
      this.ws.send(JSON.stringify({
        type: 'user_disconnect',
        data: {
          id: this.userId
        }
      }));

      setTimeout(() => {
        this.ws.close();
      }, 100);
    }
  }

  stopLocationUpdates() {
    if (this.locationUpdateInterval) {
      clearInterval(this.locationUpdateInterval);
      this.locationUpdateInterval = null;
    }
  }
}

// Create test clients
function createTestClients(count = 2) {
  const clients = [];
  
  for (let i = 1; i <= count; i++) {
    const client = new TestClient('ws://localhost:8083', `Test User ${i}`);
    clients.push(client);
    
    // Stagger connections
    setTimeout(() => {
      client.connect();
    }, i * 1000);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down test clients...');
    clients.forEach(client => client.disconnect());
    setTimeout(() => process.exit(0), 500);
  });

  return clients;
}

// Run test if this file is executed directly
if (require.main === module) {
  console.log('🧪 Starting WebSocket test clients...');
  console.log('Press Ctrl+C to stop');
  
  const numClients = process.argv[2] ? parseInt(process.argv[2]) : 2;
  console.log(`Creating ${numClients} test client(s)...`);
  
  createTestClients(numClients);
}

module.exports = TestClient;