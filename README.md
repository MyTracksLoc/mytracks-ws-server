# Live Location Sharing WebSocket Server

This is a backend server for real-time location sharing with friends, designed to work with the [MyTracks Flutter Client](https://github.com/MyTracksLoc/mytracks-flutter-client) (Android/Web). The server uses WebSockets for efficient, low-latency communication and is built with [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js).

## Features

- Real-time location updates for connected users
- Rate limiting and validation for location updates
- User presence and disconnect notifications
- Health check endpoint (`/health`)
- Easy self-hosting with Docker

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/)
- (Optional) [Node.js](https://nodejs.org/) if running without Docker

### Clone the Repository

```sh
git clone https://github.com/MyTracksLoc/live-location-share-server.git
cd live-location-share-server