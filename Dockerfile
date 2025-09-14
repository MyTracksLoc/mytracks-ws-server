# Alternative Dockerfile using Ubuntu base (glibc)
FROM ubuntu:22.04

# Install Node.js 20 and dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y \
    nodejs \
    python3 \
    make \
    g++ \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Verify Node.js version
RUN node --version && npm --version

# Set working directory
WORKDIR /usr/src/app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies (uWebSockets.js requires git for GitHub installation)
RUN npm install --only=production
RUN npm install uNetworking/uWebSockets.js#v20.52.0

# Create a non-root user for security

# Copy application files
COPY . .

# Change ownership of the app directory to the nodejs user

# Switch to non-root user

# Expose the port the app runs on
EXPOSE 8083

# Add health check
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#     CMD curl -f http://localhost:8083/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8083

# Start the application
CMD ["npm", "start"]
#CMD ["/bin/bash"]