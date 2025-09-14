# Live Location Sharing WebSocket Server

A high-performance, real-time location sharing backend server built with [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js). This server enables friends and family to share their live locations in real-time through WebSocket connections.

## 🚀 Features

- **Real-time Location Updates**: Share and receive location updates instantly via WebSocket
- **User Management**: Automatic user presence tracking and disconnect notifications
- **Redis Persistence**: Location data persisted with Redis using ZSET for time-based queries
- **Location History**: Track user location history with timestamp-based retrieval
- **Automatic Cleanup**: TTL-based cleanup of old location data
- **Health Monitoring**: Built-in health check endpoint for monitoring
- **High Performance**: Powered by uWebSockets.js for maximum efficiency
- **Docker Ready**: Easy deployment with Docker and Docker Compose
- **Production Ready**: Includes graceful shutdown, error handling, and cleanup

## 📱 Client Applications

This server works with the following client applications:

- **Android App**: [MyTracks Flutter Client](https://github.com/MyTracksLoc/mytracks-flutter-client)
- **Web App**: Available in the same Flutter client repository (web build)

## 🛠️ Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)
- [Redis](https://redis.io/) server (included in Docker Compose)
- (Optional) [Node.js 14+](https://nodejs.org/) for local development

### 1. Clone the Repository

```bash
git clone https://github.com/MyTracksLoc/live-location-share-server.git
cd live-location-share-server
```

### 2. Run with Docker Compose (Recommended)

```bash
# Start both the server and Redis
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### 3. Run with Docker (Manual)

```bash
# Start Redis first
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Build and run the server
docker build -t location-sharing-server .
docker run -p 8083:8083 --link redis:redis -e REDIS_HOST=redis location-sharing-server
```

### 4. Test the Server

```bash
# Test with the included test client
npm install
npm test

# Test Redis integration specifically
node test-redis.js
```

## 🔧 Redis Configuration

The server uses Redis for persistent storage of location data. Location data is stored using Redis ZSET (sorted set) with timestamps as scores, enabling efficient time-based queries.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | `null` | Redis password (if required) |
| `REDIS_DB` | `0` | Redis database number |

### Data Storage

- **Location Data**: Stored in ZSET with format `location_share:locations:{userId}`
- **User Metadata**: Stored in HASH with format `location_share:user:{userId}`
- **TTL**: Location data expires after 7 days, user metadata after 30 days
- **Max Entries**: Only the latest 100 location entries per user are kept

### Local Development

```bash
# Install dependencies
npm install

# Start Redis locally
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Set environment variables
export REDIS_HOST=localhost
export REDIS_PORT=6379

# Start the server
npm start
```

The server will be available at:
- **WebSocket**: `ws://localhost:8083`
- **Health Check**: `http://localhost:8083/health`

## 🐳 Docker Compose Deployment

For production deployment with both backend and frontend:

```yaml
version: '3.8'

services:
  location-sharing-backend:
    container_name: "location-sharing-backend"
    build:
      context: ./live-location-share-server
      dockerfile: Dockerfile
    networks:
      - proxy-network
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=8083
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mytracks-api.rule=Host(`api.yourdomain.com`)"
      - "traefik.http.routers.mytracks-api.entrypoints=websecure"
      - "traefik.http.services.mytracks-api.loadbalancer.server.port=8083"
      - "traefik.http.routers.mytracks-api.tls.certresolver=letencrypt"
      - "traefik.docker.network=proxy-network"

  location-sharing-frontend:
    container_name: "location-sharing-frontend"
    build:
      context: ./mytracks-flutter-client/build/web
      dockerfile: Dockerfile
    networks:
      - proxy-network
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mytracks-web.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.mytracks-web.entrypoints=websecure"
      - "traefik.http.services.mytracks-web.loadbalancer.server.port=80"
      - "traefik.http.routers.mytracks-web.tls.certresolver=letencrypt"
      - "traefik.docker.network=proxy-network"

networks:
  proxy-network:
    external: true
```

## ⚙️ Configuration

The server can be configured through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8083` | Server port |
| `NODE_ENV` | `development` | Environment mode |

### Server Configuration (in code)

```javascript
const config = {
  maxUsers: 100,                    // Maximum concurrent users
  locationUpdateInterval: 2000,     // Minimum 2 seconds between updates
  userTimeout: 30000,              // 30 seconds timeout for stale data
  maxNameLength: 50                // Maximum user name length
};
```

## 📡 API Reference

### WebSocket Connection

Connect to: `ws://your-server:8083`

### Message Types

#### 1. Location Update
Send your current location to the server:

```json
{
  "type": "location_update",
  "data": {
    "id": "user-uuid-here",
    "name": "Your Name",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "lastUpdate": "2024-01-01T12:00:00.000Z"
  }
}
```

#### 2. Get Users List
Request current connected users:

```json
{
  "type": "get_users",
  "data": {}
}
```

#### 3. Get Location History
Request location history for a user (with optional time range):

```json
{
  "type": "get_location_history",
  "data": {
    "userId": "user-uuid-here",
    "startTime": "2024-01-01T00:00:00.000Z",  // Optional
    "endTime": "2024-01-01T23:59:59.999Z"     // Optional
  }
}
```

#### 4. User Disconnect
Gracefully disconnect:

```json
{
  "type": "user_disconnect",
  "data": {
    "id": "user-uuid-here"
  }
}
```

### Server Messages

#### User Location Update
```json
{
  "type": "user_location",
  "data": {
    "id": "user-uuid",
    "name": "User Name",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "lastUpdate": "2024-01-01T12:00:00.000Z"
  }
}
```

#### Users List
```json
{
  "type": "users_list",
  "data": [
    {
      "id": "user-uuid-1",
      "name": "User 1",
      "latitude": 37.7749,
      "longitude": -122.4194,
      "lastUpdate": "2024-01-01T12:00:00.000Z",
      "connected": true
    }
  ]
}
```

#### Location History
```json
{
  "type": "location_history",
  "data": {
    "userId": "user-uuid-here",
    "history": [
      {
        "id": "user-uuid-here",
        "name": "User Name",
        "latitude": 37.7749,
        "longitude": -122.4194,
        "lastUpdate": "2024-01-01T12:00:00.000Z"
      }
    ]
  }
}
```

#### User Disconnected
```json
{
  "type": "user_disconnected",
  "data": {
    "id": "user-uuid",
    "name": "User Name"
  }
}
```

#### Error Messages
```json
{
  "type": "error",
  "data": {
    "code": "ERROR_CODE",
    "message": "Error description",
    "details": "Additional details"
  }
}
```

### HTTP Endpoints

#### Health Check
```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "connectedUsers": 5,
  "serverId": "server-abc123",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 🔧 Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

### Testing

The included test client simulates multiple users:

```bash
# Test with 2 clients
npm test

# Test with custom number of clients
node test-client.js 5
```

## 🚀 Production Deployment

### Using Docker

1. **Build the image**:
   ```bash
   docker build -t location-sharing-server .
   ```

2. **Run the container**:
   ```bash
   docker run -d \
     --name location-sharing-server \
     -p 8083:8083 \
     -e NODE_ENV=production \
     --restart unless-stopped \
     location-sharing-server
   ```

### Using Docker Compose

1. **Create docker-compose.yml**:
   ```yaml
   version: '3.8'
   services:
     location-sharing-backend:
       build: .
       ports:
         - "8083:8083"
       environment:
         - NODE_ENV=production
       restart: unless-stopped
   ```

2. **Deploy**:
   ```bash
   docker-compose up -d
   ```

### Reverse Proxy Setup

For production, use a reverse proxy like Nginx or Traefik:

#### Nginx Configuration
```nginx
upstream location_server {
    server localhost:8083;
}

server {
    listen 443 ssl;
    server_name api.yourdomain.com;
    
    location / {
        proxy_pass http://location_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 🔒 Security Considerations

- **Rate Limiting**: Built-in protection against location update spam
- **Input Validation**: All location data is validated before processing
- **User Limits**: Configurable maximum concurrent users
- **Stale Data Cleanup**: Automatic removal of inactive users
- **Error Handling**: Comprehensive error handling and logging

## 📊 Monitoring

### Health Check
Monitor server health with the `/health` endpoint:

```bash
curl http://your-server:8083/health
```

### Logs
The server provides detailed logging for:
- New connections and disconnections
- Location updates
- Errors and validation failures
- Cleanup operations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/MyTracksLoc/live-location-share-server/issues)
- **Documentation**: [Client App Repository](https://github.com/MyTracksLoc/mytracks-flutter-client)

## 🔗 Related Projects

- [MyTracks Flutter Client](https://github.com/MyTracksLoc/mytracks-flutter-client) - Android and Web client applications
- [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) - High-performance WebSocket library

---

**Made with ❤️ for real-time location sharing**