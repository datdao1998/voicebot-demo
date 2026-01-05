from fastapi import UploadFile, File
import speech_recognition as sr
import pyttsx3

recognizer = sr.Recognizer()
text_to_speech_engine = pyttsx3.init()

async def process_voice_stream(file: UploadFile = File(...)):
    # Save the uploaded voice file temporarily
    with open("temp_audio.wav", "wb") as audio_file:
        audio_file.write(await file.read())

    # Convert voice to text
    with sr.AudioFile("temp_audio.wav") as source:
        audio_data = recognizer.record(source)
        text = recognizer.recognize_google(audio_data)

    # Convert text back to voice
    text_to_speech_engine.save_to_file(text, "response_audio.wav")
    text_to_speech_engine.runAndWait()

    # Return the path to the generated audio file
    return "response_audio.wav"