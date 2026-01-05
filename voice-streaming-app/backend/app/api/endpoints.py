import asyncio
import os
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydub import AudioSegment
from io import BytesIO

router = APIRouter()

# Directory to save recordings
RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

@router.websocket("/ws")
async def voice_stream(websocket: WebSocket):
    await websocket.accept()
    
    audio_chunks = []      # Collect raw WebM chunks
    chunk_count = 0

    print("Client connected – starting new recording session")

    try:
        while True:
            data = await websocket.receive_bytes()
            audio_chunks.append(data)
            chunk_count += 1
            print(f"Received chunk {chunk_count}: {len(data)} bytes")

            # Echo back (or process) if you still want real-time response
            response = await process_voice_data(data)
            await websocket.send_bytes(response)

    except WebSocketDisconnect:
        print(f"Client disconnected – converting & saving {chunk_count} chunks to WAV")

        if not audio_chunks:
            print("No audio data received")
            return

        # Combine all raw WebM chunks
        full_webm_bytes = b"".join(audio_chunks)

        try:
            # Load the combined WebM data in memory
            audio = AudioSegment.from_file(BytesIO(full_webm_bytes), format="webm")

            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            wav_filename = f"{RECORDINGS_DIR}/recording_{timestamp}.wav"

            # Export as WAV (you can customize sample rate, channels, etc.)
            audio.export(wav_filename, format="wav")

            print(f"✅ WAV recording saved: {wav_filename}")
            print(f"   Duration: {len(audio)/1000:.2f}s | Channels: {audio.channels} | Sample rate: {audio.frame_rate} Hz")

        except Exception as conv_err:
            print(f"❌ Conversion to WAV failed: {conv_err}")
            # Fallback: save raw WebM if conversion fails
            webm_fallback = f"{RECORDINGS_DIR}/raw_fallback_{timestamp}.webm"
            with open(webm_fallback, "wb") as f:
                f.write(full_webm_bytes)
            print(f"Fallback raw WebM saved: {webm_fallback}")

    except Exception as e:
        print(f"Unexpected error: {e}")


async def process_voice_data(data: bytes) -> bytes:
    # Your existing processing (e.g., echo, transcription, etc.)
    await asyncio.sleep(0.01)
    return data  # Echo for now