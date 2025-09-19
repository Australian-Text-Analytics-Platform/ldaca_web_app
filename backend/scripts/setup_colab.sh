#!/bin/bash


# Get the absolute path to the script (works in most cases)
SCRIPT_PATH="$(realpath "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NGINX_CONFIG_PATH="$PROJECT_ROOT/configs/nginx.conf.template"
ENV_PATH="$PROJECT_ROOT/.env"
FRONTEND_PORT=3000 FRONTEND_DIR="$PROJECT_ROOT/ldaca_web_app/frontend" envsubst < "$NGINX_CONFIG_PATH"
