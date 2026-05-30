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

export VISION_BACKEND=$(bashio::config 'vision_backend')
export ANTHROPIC_API_KEY=$(bashio::config 'anthropic_api_key')
export OLLAMA_URL=$(bashio::config 'ollama_url')
export OLLAMA_MODEL=$(bashio::config 'ollama_model')

# Supervisor token for HA API access (auto-injected when homeassistant_api: true)
export HA_TOKEN="${SUPERVISOR_TOKEN}"

bashio::log.info "Starting Box Inventory Tracker..."
bashio::log.info "Connecting to MariaDB at ${DB_HOST}:${DB_PORT}"
bashio::log.info "Vision backend: ${VISION_BACKEND}"

cd /app

python3 -c "from server import init_db, migrate_db, sync_ha_areas; init_db(); migrate_db(); sync_ha_areas()"

# Single worker with multiple threads.
# SSE live-sync uses an in-memory client registry (_sse_clients) which must be
# shared across all request handlers — this only works within a single process.
# gthread gives us concurrent request handling via threads within that one process.
# 8 threads handles typical household usage (several simultaneous packers) easily.
exec gunicorn \
    --bind 0.0.0.0:5000 \
    --workers 1 \
    --worker-class gthread \
    --threads 8 \
    --timeout 180 \
    --graceful-timeout 30 \
    --log-level info \
    server:app
