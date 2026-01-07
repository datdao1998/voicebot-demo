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
    print("✅ Client connected\n")
    
    try:
        while True:  # Keep connection alive for multiple recordings
            # Reset state for each new recording session
            audio_chunks = []
            chunk_count = 0
            is_recording = False
            
            print("🎧 Waiting for recording to start...")
            
            # Inner loop for a single recording session
            while True:
                try:
                    message = await asyncio.wait_for(
                        websocket.receive(),
                        timeout=300.0  # 5 minute timeout
                    )
                    
                    # Check if connection is closing
                    if message.get("type") == "websocket.disconnect":
                        print("🔌 Client initiated disconnect")
                        return  # Exit completely
                    
                    # Handle binary data (audio chunks)
                    if "bytes" in message:
                        data = message["bytes"]
                        
                        # Only collect chunks if we're actively recording
                        if is_recording or chunk_count == 0:
                            audio_chunks.append(data)
                            chunk_count += 1
                            is_recording = True
                            
                            if chunk_count == 1:
                                print(f"🎤 Recording started (first chunk received)")
                            elif chunk_count % 20 == 0:
                                print(f"📦 Received {chunk_count} chunks (total: {sum(len(c) for c in audio_chunks)} bytes)")
                        
                        # Echo back (optional)
                        try:
                            await websocket.send_bytes(data)
                        except Exception:
                            pass
                    
                    # Handle text messages
                    elif "text" in message:
                        try:
                            msg_data = json.loads(message["text"])
                            action = msg_data.get("action")
                            
                            if action == "stop_recording":
                                print(f"\n🛑 Stop recording signal received!")
                                print(f"   Total chunks collected: {chunk_count}")
                                print(f"   Total bytes: {sum(len(c) for c in audio_chunks)}")
                                
                                if chunk_count > 0:
                                    # Process this recording
                                    await process_and_respond(websocket, audio_chunks)
                                    print("✅ Processing complete - ready for next recording\n")
                                else:
                                    print("⚠️ No audio chunks received!")
                                    await websocket.send_text(json.dumps({
                                        "type": "error",
                                        "message": "No audio data received"
                                    }))
                                
                                # Break inner loop to reset for next recording
                                break
                                
                        except json.JSONDecodeError:
                            print(f"⚠️ Invalid JSON: {message['text']}")
                
                except asyncio.TimeoutError:
                    print("⏱️ Connection timeout")
                    return  # Exit completely
                    
                except WebSocketDisconnect:
                    print("❌ Client disconnected")
                    return  # Exit completely
                    
                except RuntimeError as e:
                    if "disconnect" in str(e).lower():
                        print("❌ Disconnect detected")
                        return  # Exit completely
                    else:
                        raise
    
    except WebSocketDisconnect:
        print("❌ WebSocket disconnected unexpectedly")
    except Exception as e:
        print(f"❌ Error in WebSocket handler: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print("🔌 WebSocket connection closed\n")
        try:
            await websocket.close()
        except:
            pass


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
        print(f"   Combined size: {len(full_webm_bytes)} bytes")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save raw WebM first
        webm_filename = f"{RECORDINGS_DIR}/recording_{timestamp}.webm"
        with open(webm_filename, "wb") as f:
            f.write(full_webm_bytes)
        print(f"✅ Raw WebM saved: {webm_filename}")
        
        # Convert to WAV
        wav_filename = f"{RECORDINGS_DIR}/recording_{timestamp}.wav"
        try:
            # Verify the WebM file is valid
            file_size = os.path.getsize(webm_filename)
            print(f"   WebM file size: {file_size} bytes")
            
            if file_size < 1000:
                print(f"⚠️ WebM file too small ({file_size} bytes), might be corrupted")
            
            # Try loading from file (more reliable than BytesIO)
            print("   Attempting AudioSegment.from_file...")
            audio = AudioSegment.from_file(webm_filename, format="webm")
            print(f"   ✅ AudioSegment loaded: {len(audio)}ms, {audio.frame_rate}Hz")
            
            audio.export(wav_filename, format="wav")
            print(f"✅ WAV converted: {wav_filename}")
            print(f"   Duration: {len(audio)/1000:.2f}s")
            file_to_transcribe = wav_filename
            
        except Exception as conv_err:
            print(f"⚠️ WebM conversion failed: {type(conv_err).__name__}: {conv_err}")
            print("   Trying alternative methods...")
            
            # Try with different parameters
            try:
                print("   Attempt 2: Using codec='opus'...")
                audio = AudioSegment.from_file(webm_filename, codec="opus")
                audio.export(wav_filename, format="wav")
                print(f"✅ WAV converted (opus): {wav_filename}")
                file_to_transcribe = wav_filename
                
            except Exception as e2:
                print(f"⚠️ Opus conversion failed: {type(e2).__name__}: {e2}")
                
                try:
                    print("   Attempt 3: Using BytesIO with raw bytes...")
                    audio = AudioSegment.from_file(BytesIO(full_webm_bytes), format="webm")
                    audio.export(wav_filename, format="wav")
                    print(f"✅ WAV converted (BytesIO): {wav_filename}")
                    file_to_transcribe = wav_filename
                    
                except Exception as e3:
                    print(f"⚠️ BytesIO conversion failed: {type(e3).__name__}: {e3}")
                    print("   All conversion methods failed - using WebM directly")
                    file_to_transcribe = webm_filename
        
        # 2. Transcribe
        print("🎯 Transcribing audio...")
        transcript = transcribe_audio(file_to_transcribe)
        print(f"📝 Transcript: '{transcript}'")
        
        # Send transcript
        await websocket.send_text(json.dumps({
            "type": "transcript",
            "text": transcript
        }))
        print("✅ Transcript sent")
        
        await asyncio.sleep(0.1)
        
        # 3. Generate response audio
        print("🔊 Generating TTS response...")
        response_text = f"You said: {transcript}. Thank you for your message!"
        response_audio_path = generate_response_audio(response_text, timestamp)
        
        if response_audio_path and os.path.exists(response_audio_path):
            print(f"✅ Response audio: {response_audio_path}")
            
            with open(response_audio_path, "rb") as f:
                audio_bytes = f.read()
            
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            
            await websocket.send_text(json.dumps({
                "type": "audio",
                "data": audio_base64,
                "format": "wav"
            }))
            print("✅ Audio sent")
        else:
            print("⚠️ Failed to generate response audio")
        
        await asyncio.sleep(0.1)
        
        # 4. Send completion
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


def transcribe_audio(audio_file_path):
    """Transcribe audio using Google Speech Recognition"""
    recognizer = sr.Recognizer()
    
    try:
        # Convert to WAV if needed
        if not audio_file_path.endswith('.wav'):
            print(f"   Converting {audio_file_path} to WAV...")
            try:
                audio = AudioSegment.from_file(audio_file_path)
                wav_temp = audio_file_path.replace('.webm', '_temp.wav')
                audio.export(wav_temp, format="wav")
                audio_file_path = wav_temp
                print(f"   Temp WAV: {wav_temp}")
            except Exception as e:
                print(f"   Conversion failed: {e}")
                return "Audio format conversion failed"
        
        with sr.AudioFile(audio_file_path) as source:
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            audio_data = recognizer.record(source)
            
            # Use Google Speech Recognition
            text = recognizer.recognize_google(audio_data)
            
            # Clean up temp file
            if '_temp.wav' in audio_file_path:
                try:
                    os.remove(audio_file_path)
                except:
                    pass
            
            return text
            
    except sr.UnknownValueError:
        return "Could not understand audio"
    except sr.RequestError as e:
        print(f"Recognition error: {e}")
        return "Recognition service error"
    except Exception as e:
        print(f"Transcription error: {e}")
        import traceback
        traceback.print_exc()
        return "Transcription failed"


def generate_response_audio(text, timestamp):
    """Generate TTS audio response"""
    response_dir = f"{RECORDINGS_DIR}/responses"
    os.makedirs(response_dir, exist_ok=True)
    
    output_path = f"{response_dir}/response_{timestamp}.wav"
    
    try:
        from gtts import gTTS
        
        # Generate MP3
        mp3_path = output_path.replace('.wav', '.mp3')
        tts = gTTS(text=text, lang='en', slow=False)
        tts.save(mp3_path)
        
        # Convert to WAV
        audio = AudioSegment.from_mp3(mp3_path)
        audio.export(output_path, format="wav")
        
        # Cleanup
        if os.path.exists(mp3_path):
            os.remove(mp3_path)
        
        return output_path
        
    except ImportError:
        print("⚠️ gTTS not installed")
        return generate_response_audio_offline(text, timestamp)
    except Exception as e:
        print(f"TTS error: {e}")
        return None


def generate_response_audio_offline(text, timestamp):
    """Fallback: offline TTS using pyttsx3"""
    try:
        import pyttsx3
        
        response_dir = f"{RECORDINGS_DIR}/responses"
        os.makedirs(response_dir, exist_ok=True)
        output_path = f"{response_dir}/response_{timestamp}.wav"
        
        engine = pyttsx3.init()
        engine.setProperty('rate', 150)
        engine.setProperty('volume', 0.9)
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        
        return output_path
    except Exception as e:
        print(f"Offline TTS error: {e}")
        return None