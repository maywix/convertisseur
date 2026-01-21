#!/bin/bash

# Stop existing containers
echo "Stopping existing containers..."
sudo docker-compose down

# Rebuild using cache (faster for small changes)
echo "Building Docker image (with cache)..."
sudo docker-compose build

# Start the application
echo "Starting application..."
sudo docker-compose up -d

echo "Application restarted successfully!"
echo "You can check logs with: sudo docker-compose logs -f"
