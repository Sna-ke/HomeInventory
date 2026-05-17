#!/usr/bin/with-contenv bashio

export DB_HOST=$(bashio::config 'db_host')
export DB_PORT=$(bashio::config 'db_port')
export DB_NAME=$(bashio::config 'db_name')
export DB_USER=$(bashio::config 'db_user')
export DB_PASSWORD=$(bashio::config 'db_password')

bashio::log.info "Starting Box Inventory Tracker..."
bashio::log.info "Connecting to MariaDB at ${DB_HOST}:${DB_PORT}/${DB_NAME}"

cd /app
python3 server.py
