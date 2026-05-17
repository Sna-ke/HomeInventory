#!/usr/bin/with-contenv bashio

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

# Initialize the database (create DB + tables if needed)
python3 -c "from server import init_db; init_db()"

# Run with Gunicorn instead of Flask's dev server
exec gunicorn \
    --bind 0.0.0.0:5000 \
    --workers 2 \
    --log-level info \
    server:app
