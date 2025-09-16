FROM node:18-alpine

# Install PM2 globally
RUN npm install -g pm2

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY templates/ ./templates/

# Create directories
RUN mkdir -p logs working public

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "fetch('http://localhost:3005/api/health').then(r=>r.ok||process.exit(1))"

# Start the service
CMD ["npm", "start"]
