"""Entry point: python -m poko_server"""
import uvicorn
from poko_server import config

if __name__ == "__main__":
    uvicorn.run(
        "poko_server.api:app",
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        log_level="info",
    )
