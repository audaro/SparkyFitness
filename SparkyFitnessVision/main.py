import logging
import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

from models import ENGINE, require_models
from routes import router as vision_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()
PORT = int(os.getenv("VISION_SERVICE_PORT", 8100))

app = FastAPI(title="SparkyFitness Vision")
app.include_router(vision_router)


@app.get("/")
async def read_root():
    return {"message": "SparkyFitness Vision Microservice is running!", "engine": ENGINE}


if __name__ == "__main__":
    # Fail at boot, not at the first photo: a missing model file is a
    # deployment mistake, and a service that starts and then refuses every
    # request looks like a bug in the feature instead.
    require_models()
    logger.info("Vision service starting on port %s with engine %s", PORT, ENGINE)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
