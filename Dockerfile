# Multi-stage build for LTE Band Selector

# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Setup Backend
FROM node:22-alpine
WORKDIR /app

# Install telnet, Python and speedtest dependencies
RUN apk add --no-cache busybox-extras python3 py3-pip

# Copy backend files
COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./backend

# Copy built frontend from previous stage
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 3001

WORKDIR /app/backend

# Start the backend server
CMD ["node", "index.js"]
