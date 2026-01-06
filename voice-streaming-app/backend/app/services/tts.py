import requests
from uuid import uuid4
from app.config import config

def tts(input: str):
    url = config.tts_url
    payload = {
        "text": input
    }

    headers = {
        "Content-Type": "application/json"
    }

    output_path = f"{str(uuid4())}.wav"

    response = requests.post(url, json=payload, headers=headers, stream=True)
    response.raise_for_status()

    with open(output_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    print(f"Saved audio to {output_path}")

    return output_path


tts("xin chào thế giới")