# Voice Streaming Application Backend

This is the backend component of the Voice Streaming Application, built using FastAPI. The backend is responsible for handling voice streaming from clients, processing the voice data, and responding back in voice format.

## Project Structure

- `app/main.py`: Entry point of the FastAPI application. Initializes the app and sets up middleware and routes.
- `app/api/endpoints.py`: Defines API endpoints for managing voice streaming.
- `app/services/voice_processing.py`: Contains logic for processing voice data, including conversion between voice streams and text.
- `app/models/__init__.py`: Initializes the models package for voice processing.

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   cd voice-streaming-app/backend
   ```

2. Install the required dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Run the FastAPI application:
   ```
   uvicorn app.main:app --reload
   ```

4. Access the API documentation at `http://localhost:8000/docs`.

## Usage

- The backend listens for incoming voice streams and processes them according to the defined API endpoints.
- Ensure that the frontend is properly configured to communicate with this backend service.

## Contributing

Feel free to submit issues or pull requests for improvements and bug fixes.