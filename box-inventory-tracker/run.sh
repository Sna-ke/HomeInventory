#!/usr/bin/with-contenv bashio

# The Supervisor injects these environment variables automatically
# when services: mysql:want is declared in config.yaml and
# the MariaDB add-on is installed and running.
if ! bashio::services.available "mysql"; then
    bashio::log.fatal "MariaDB service is not available. Please install and start the MariaDB add-on."
    exit 1
fi

export DB_HOST=$(bashio::services "mysql" "host")
export DB_PORT=$(bashio::services "mysql" "port")
export DB_USER=$(bashio::services "mysql" "username")
export DB_PASSWORD=$(bashio::services "mysql" "password")
export DB_NAME="box_inventory"

bashio::log.info "Starting Box Inventory Tracker..."
bashio::log.info "Connecting to MariaDB at ${DB_HOST}:${DB_PORT}"

cd /app
python3 server.py
