#!/bin/bash


# Get the absolute path to the script (works in most cases)
SCRIPT_PATH="$(realpath "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
NGINX_CONFIG_PATH="$SCRIPT_DIR/../configs/nginx.conf.template"
ENV_PATH="$SCRIPT_DIR/../.env"
source "$ENV_PATH"
echo $SERVER_PORT
