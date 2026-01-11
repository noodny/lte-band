# LTE Band Selector

A React + Node.js application for selecting LTE bands with a mobile-friendly interface.

## Project Structure

- `frontend/` - React application built with Vite
- `backend/` - Fastify API server

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

### Backend Setup

```bash
cd backend
npm install
```

### Frontend Setup

```bash
cd frontend
npm install
```

## Running the Application

### Start Backend (Terminal 1)

```bash
cd backend
npm run dev
```

The backend will run on `http://localhost:3001`

### Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:3000`

## Features

### Frontend

- Mobile-optimized interface
- Toggle buttons for LTE bands: 0, 1, 3, 7, 8, 20
- Visual feedback for selected bands
- Save functionality to submit selected values

### Backend

- **GET /status** - Status endpoint (barebone)
- **POST /save** - Save endpoint for receiving selected bands (barebone)

## API Endpoints

### GET /status

Returns server status

### POST /save

Accepts selected band data

- Request body: `{ "bands": [0, 1, 3] }`
- Response: `{ "success": true, "received": {...} }`

## Development

The frontend is configured to proxy API requests to the backend automatically. All requests to `/api/*` will be forwarded to `http://localhost:3001`.
