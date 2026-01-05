# Voice Streaming Application

This project is a voice streaming application that utilizes FastAPI for the backend and React for the frontend. The application allows clients to send voice data as a stream and receive voice responses in real-time.

## Project Structure

```
voice-streaming-app
├── backend
│   ├── app
│   │   ├── main.py               # Entry point for the FastAPI application
│   │   ├── api
│   │   │   └── endpoints.py      # API endpoints for voice streaming
│   │   ├── services
│   │   │   └── voice_processing.py # Logic for processing voice data
│   │   └── models
│   │       └── __init__.py       # Initialization of models package
│   ├── requirements.txt           # Backend dependencies
│   └── README.md                  # Documentation for the backend
├── frontend
│   ├── public
│   │   └── index.html             # Main HTML file for the React application
│   ├── src
│   │   ├── App.js                 # Main component of the React application
│   │   ├── components
│   │   │   └── VoiceStream.js     # Component for voice streaming interface
│   │   └── services
│   │       └── api.js             # API calls to the backend
│   ├── package.json               # Configuration for npm
│   └── README.md                  # Documentation for the frontend
└── README.md                      # Overall documentation for the project
```

## Getting Started

### Prerequisites

- Python 3.7 or higher
- Node.js and npm

### Backend Setup

1. Navigate to the `backend` directory.
2. Install the required dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Run the FastAPI application:
   ```
   uvicorn app.main:app --reload
   ```

### Frontend Setup

1. Navigate to the `frontend` directory.
2. Install the required dependencies:
   ```
   npm install
   ```
3. Start the React application:
   ```
   npm start
   ```

## Usage

- Access the frontend application at `http://localhost:3000`.
- Use the voice streaming interface to send voice data and receive responses.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License.