"""
Command-line interface for LDaCA Web App Backend.
"""


def main():
    """Main entry point for the CLI."""
    import uvicorn

    from .settings import settings

    # Ensure data root exists
    data_root = settings.get_data_root()
    data_root.mkdir(parents=True, exist_ok=True)

    print("Starting LDaCA Web App Backend")
    print(f"Data folder: {data_root}")
    print(f"Server: http://{settings.server_host}:{settings.backend_port}")
    print(f"Multi-user mode: {settings.multi_user}")
    print()

    # Run the FastAPI app
    uvicorn.run(
        "ldaca_web_app_backend.main:app",
        host=settings.server_host,
        port=settings.backend_port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    main()
    main()
    main()
