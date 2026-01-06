import asyncio
import os
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydub import AudioSegment
from io import BytesIO
import speech_recognition as sr
import base64
import json

router = APIRouter()

RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

@router.websocket("/ws")
async def voice_stream(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")
    
    try:
        while True:
            # Reset for each recording session
            audio_chunks = []
            chunk_count = 0
            recording_started = False
            
            print("\n🎤 Ready for new recording...")
            
            # Inner loop for each recording
            recording_active = True
            while recording_active:
                try:
                    message = await asyncio.wait_for(
                        websocket.receive(),
                        timeout=300.0  # 5 minute timeout
                    )
                except asyncio.TimeoutError:
                    print("⏱️ Connection timeout")
                    return  # Exit completely on timeout
                
                # Handle different message types
                if "bytes" in message:
                    # Audio chunk received
                    data = message["bytes"]
                    
                    # Only accept audio chunks if we haven't processed yet
                    if recording_active and not recording_started:
                        recording_started = True
                        print("🎙️ First audio chunk received, recording started")
                    
                    if recording_active:
                        audio_chunks.append(data)
                        chunk_count += 1
                        
                        if chunk_count % 20 == 0:
                            print(f"📦 Received {chunk_count} chunks (total size: {sum(len(c) for c in audio_chunks)} bytes)")
                        
                        # Echo back (optional)
                        try:
                            await websocket.send_bytes(data)
                        except Exception as e:
                            print(f"Echo failed: {e}")
                    
                elif "text" in message:
                    # Text message received
                    try:
                        msg_data = json.loads(message["text"])
                        action = msg_data.get("action")
                        
                        if action == "stop_recording":
                            print(f"\n🛑 Stop signal received!")
                            print(f"   Total chunks: {chunk_count}")
                            print(f"   Total bytes: {sum(len(c) for c in audio_chunks)}")
                            
                            if chunk_count > 0:
                                await process_and_respond(websocket, audio_chunks)
                            else:
                                print("⚠️ No audio chunks received!")
                                await websocket.send_text(json.dumps({
                                    "type": "error",
                                    "message": "No audio data received"
                                }))
                            
                            recording_active = False  # Exit inner loop, but keep WebSocket alive
                            # Clear the list to free memory
                            audio_chunks.clear()
                            print("✅ Ready for next recording\n")
                        
                        elif action == "start_recording":
                            print("▶️ Start recording signal received")
                            # Reset state for new recording
                            audio_chunks.clear()
                            chunk_count = 0
                            recording_started = False
                            
                        else:
                            print(f"Unknown action: {action}")
                            
                    except json.JSONDecodeError:
                        print(f"Received non-JSON text: {message['text']}")
                
                else:
                    print(f"Unknown message type: {message}")
    
    except WebSocketDisconnect:
        print("❌ Client disconnected")
    except Exception as e:
        print(f"❌ Error in WebSocket handler: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print("🔌 WebSocket connection closing\n")


async def process_and_respond(websocket: WebSocket, audio_chunks):
    """Process audio chunks and send transcript + response"""
    
    if not audio_chunks:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "No audio data received"
        }))
        return
    
    try:
        # 1. Combine and save audio
        print("📁 Combining audio chunks...")
        full_webm_bytes = b"".join(audio_chunks)
        audio = AudioSegment.from_file(BytesIO(full_webm_bytes), format="webm")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        wav_filename = f"{RECORDINGS_DIR}/recording_{timestamp}.wav"
        
        audio.export(wav_filename, format="wav")
        print(f"✅ Saved: {wav_filename}")
        print(f"   Duration: {len(audio)/1000:.2f}s")
        
        # 2. Transcribe
        print("🎯 Transcribing audio...")
        transcript = transcribe_audio(wav_filename)
        print(f"📝 Transcript: '{transcript}'")
        
        # Send transcript to client
        await websocket.send_text(json.dumps({
            "type": "transcript",
            "text": transcript
        }))
        print("✅ Transcript sent to client")
        
        # 3. Generate response audio
        print("🔊 Generating TTS response...")

        response_audio_path = "/Users/datdq98/Desktop/GITHUB/voicebot-demo/voice-streaming-app/backend/recordings/responses/response.wav"

        # response_text = f"You said: {transcript}. Thank you for your message!"
        # response_audio_path = generate_response_audio(response_text, timestamp)

        if response_audio_path and os.path.exists(response_audio_path):
            print(f"✅ Response audio created: {response_audio_path}")
            
            # Read and encode audio
            with open(response_audio_path, "rb") as f:
                audio_bytes = f.read()
            
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            print(f"📤 Sending response audio ({len(audio_bytes)} bytes)")
            
            # Send audio to client
            await websocket.send_text(json.dumps({
                "type": "audio",
                "data": audio_base64,
                "format": "wav"
            }))
            print("✅ Audio sent to client")
        else:
            print("⚠️ Failed to generate response audio")
        
        # 4. Send completion signal
        await websocket.send_text(json.dumps({
            "type": "complete",
            "message": "Processing complete"
        }))
        print("✅ Complete signal sent")
        
    except Exception as e:
        print(f"❌ Processing error: {e}")
        import traceback
        traceback.print_exc()
        
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(e)
            }))
        except:
            pass


def transcribe_audio(wav_file_path):
    """Transcribe audio using Google Speech Recognition"""
    recognizer = sr.Recognizer()
    
    try:
        with sr.AudioFile(wav_file_path) as source:
            # Adjust for ambient noise
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            audio_data = recognizer.record(source)
            
            # Use Google Speech Recognition
            text = recognizer.recognize_google(audio_data)
            return text
            
    except sr.UnknownValueError:
        return "Could not understand audio"
    except sr.RequestError as e:
        print(f"Speech recognition error: {e}")
        return f"Recognition service error"
    except Exception as e:
        print(f"Transcription error: {e}")
        return f"Transcription failed"


def generate_response_audio(text, timestamp):
    """Generate TTS audio response"""
    response_dir = f"{RECORDINGS_DIR}/responses"
    os.makedirs(response_dir, exist_ok=True)
    
    output_path = f"{response_dir}/response_{timestamp}.wav"
    
    try:
        from gtts import gTTS
        
        print(f"🔊 Generating TTS for: '{text}'")
        
        # Generate MP3 first
        mp3_path = output_path.replace('.wav', '.mp3')
        tts = gTTS(text=text, lang='en', slow=False)
        tts.save(mp3_path)
        print(f"✅ MP3 saved: {mp3_path}")
        
        # Convert to WAV
        audio = AudioSegment.from_mp3(mp3_path)
        audio.export(output_path, format="wav")
        print(f"✅ WAV saved: {output_path}")
        
        # Cleanup MP3
        if os.path.exists(mp3_path):
            os.remove(mp3_path)
        
        return output_path
        
    except ImportError:
        print("⚠️ gTTS not installed. Install with: pip install gtts")
        # Try offline alternative
        return generate_response_audio_offline(text, timestamp)
    except Exception as e:
        print(f"TTS error: {e}")
        import traceback
        traceback.print_exc()
        # Try offline alternative
        return generate_response_audio_offline(text, timestamp)


def generate_response_audio_offline(text, timestamp):
    """Fallback: offline TTS using pyttsx3"""
    try:
        import pyttsx3
        
        response_dir = f"{RECORDINGS_DIR}/responses"
        os.makedirs(response_dir, exist_ok=True)
        output_path = f"{response_dir}/response_{timestamp}.wav"
        
        print(f"🔊 Using offline TTS for: '{text}'")
        
        engine = pyttsx3.init()
        engine.setProperty('rate', 150)
        engine.setProperty('volume', 0.9)
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        
        print(f"✅ Offline TTS saved: {output_path}")
        return output_path
    except Exception as e:
        print(f"Offline TTS error: {e}")
        return None