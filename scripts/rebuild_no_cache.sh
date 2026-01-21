#!/bin/bash

# Stop existing containers
echo "Stopping existing containers..."
sudo docker-compose down

# Rebuild without cache
echo "Building Docker image (no cache)..."
sudo docker-compose build --no-cache

# Start the application
echo "Starting application..."
sudo docker-compose up -d

echo "Application restarted successfully!"
echo "You can check logs with: sudo docker-compose logs -f"
