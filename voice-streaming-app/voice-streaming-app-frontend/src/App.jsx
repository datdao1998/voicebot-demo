import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Initializing...');
  const [wsConnected, setWsConnected] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const [clickCount, setClickCount] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [responseAudio, setResponseAudio] = useState(null);
  
  const mediaRecorderRef = useRef(null);
  const websocketRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef(null);
  const shouldReconnectRef = useRef(true);

  const addLog = useCallback((message) => {
    const logMessage = `${new Date().toLocaleTimeString()}: ${message}`;
    console.log(logMessage);
    if (mountedRef.current) {
      setDebugLog(prev => [...prev.slice(-9), logMessage]);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    addLog('Component mounted ✅');

    return () => {
      mountedRef.current = false;
      shouldReconnectRef.current = false;
      addLog('Component unmounting...');
    };
  }, [addLog]);

  const connectWebSocket = useCallback(() => {
    if (!mountedRef.current) return;

    addLog('🔄 Creating WebSocket connection...');
    
    try {
      const ws = new WebSocket('ws://localhost:8000/ws');
      
      ws.onopen = () => {
        if (!mountedRef.current) return;
        addLog('✅ WebSocket CONNECTED');
        console.log('WebSocket state:', ws.readyState);
        setStatus('Connected – Ready to record');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        
        // Check if it's JSON or binary
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
          } catch (e) {
            addLog(`Received text: ${event.data}`);
          }
        } else {
          // Binary data (echo during recording)
          addLog(`📨 Received ${event.data.size} bytes`);
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        addLog('❌ WebSocket ERROR');
        setStatus('Connection error');
        setWsConnected(false);
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        addLog(`🔌 WebSocket CLOSED (code: ${event.code}, reason: ${event.reason})`);
        console.log('Close event:', event);
        setWsConnected(false);
        websocketRef.current = null;
        
        if (shouldReconnectRef.current && event.code !== 1000) {
          setStatus('Disconnected – Retrying in 3s...');
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current && shouldReconnectRef.current) {
              connectWebSocket();
            }
          }, 3000);
        }
      };

      websocketRef.current = ws;
      
    } catch (err) {
      addLog(`❌ Failed to create WebSocket: ${err.message}`);
      setStatus('WebSocket creation failed');
      setWsConnected(false);
    }
  }, [addLog]);

  const handleServerMessage = (message) => {
    addLog(`📩 Server message: ${message.type}`);
    
    switch (message.type) {
      case 'transcript':
        addLog(`📝 Transcript: ${message.text}`);
        setTranscript(message.text);
        setStatus('✅ Transcript received! Waiting for response...');
        break;
        
      case 'audio':
        addLog('🔊 Response audio received');
        setResponseAudio(message.data);
        playResponseAudio(message.data, message.format);
        setStatus('▶️ Playing response audio...');
        break;
        
      case 'complete':
        addLog('✅ Processing complete');
        setIsProcessing(false);
        setStatus('🎉 Recording complete! Ready for next recording.');
        
        // Add to recordings list - use current state values directly
        const timestamp = new Date().toLocaleTimeString();
        
        // Use setTimeout to ensure state is updated
        setTimeout(() => {
          setTranscript(currentTranscript => {
            setResponseAudio(currentAudio => {
              if (currentTranscript && currentAudio) {
                setRecordings(prev => {
                  // Check if this exact transcript already exists to avoid duplicates
                  const exists = prev.some(r => r.transcript === currentTranscript && r.time === timestamp);
                  if (!exists) {
                    addLog(`Added to history: "${currentTranscript}"`);
                    return [...prev, {
                      time: timestamp,
                      transcript: currentTranscript,
                      response: currentAudio
                    }];
                  }
                  return prev;
                });
              }
              return currentAudio;
            });
            return currentTranscript;
          });
        }, 100);
        
        // Clear after a delay
        setTimeout(() => {
          if (mountedRef.current) {
            setTranscript('');
            setResponseAudio(null);
          }
        }, 10000);
        break;
        
      case 'error':
        addLog(`❌ Server error: ${message.message}`);
        setStatus(`Error: ${message.message}`);
        setIsProcessing(false);
        break;
        
      default:
        addLog(`Unknown message type: ${message.type}`);
    }
  };

  const playResponseAudio = (base64Data, format) => {
    try {
      addLog('🎵 Decoding audio data...');
      
      // Decode base64 to binary
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      addLog(`✅ Decoded ${bytes.length} bytes`);
      
      // Create blob and play
      const blob = new Blob([bytes], { type: `audio/${format}` });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      audio.onplay = () => {
        addLog('▶️ Playing response audio...');
        setStatus('▶️ Playing response...');
      };
      
      audio.onended = () => {
        addLog('✅ Audio playback complete');
        setStatus('✅ Playback complete!');
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = (e) => {
        addLog(`❌ Audio play error: ${e.type}`);
        console.error('Audio error:', e);
      };
      
      audio.play().catch(err => {
        addLog(`❌ Play failed: ${err.message}`);
        console.error('Play error:', err);
      });
      
    } catch (e) {
      addLog(`❌ Error playing audio: ${e.message}`);
      console.error('Playback error:', e);
    }
  };

  useEffect(() => {
    connectWebSocket();

    return () => {
      shouldReconnectRef.current = false;
      
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      
      if (websocketRef.current) {
        const ws = websocketRef.current;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      }
      
      websocketRef.current = null;
    };
  }, [connectWebSocket]);

  const handleButtonClick = () => {
    const newCount = clickCount + 1;
    setClickCount(newCount);
    addLog(`🖱️ Button clicked (${newCount})`);
    
    if (isRecording) {
      addLog('→ Stopping...');
      stopRecording();
    } else {
      addLog('→ Starting...');
      startRecording();
    }
  };

  const startRecording = async () => {
    addLog('📍 startRecording() called');
    
    if (isRecording) {
      addLog('Already recording');
      return;
    }

    if (!wsConnected) {
      addLog('❌ WebSocket not connected');
      setStatus('❌ Not connected - Wait for connection');
      return;
    }
  
    addLog('🎤 Requesting microphone...');
    setStatus('Requesting microphone...');
  
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000
        }
      });
      
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      
      addLog(`✅ Microphone access granted`);
      streamRef.current = stream;
  
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
  
      addLog(`MIME: ${mimeType}`);
  
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
  
      let chunkCount = 0;
  
      mediaRecorder.ondataavailable = (event) => {
        if (!mountedRef.current) return;
        
        if (event.data.size > 0) {
          chunkCount++;
          
          if (websocketRef.current?.readyState === WebSocket.OPEN) {
            try {
              websocketRef.current.send(event.data);
              if (chunkCount % 10 === 0) {
                addLog(`📦 Sent ${chunkCount} chunks`);
              }
            } catch (err) {
              addLog(`❌ Send error: ${err.message}`);
            }
          }
        }
      };
  
      mediaRecorder.onstart = () => {
        if (mountedRef.current) addLog('🔴 Recording started');
      };
      
      mediaRecorder.onstop = () => {
        if (mountedRef.current) addLog('🛑 Recording stopped');
        stream.getTracks().forEach(t => t.stop());
      };
      
      mediaRecorder.onerror = (e) => {
        if (mountedRef.current) addLog(`❌ Recorder error: ${e.error}`);
      };
  
      mediaRecorder.start(250);
      addLog('Recording started (250ms chunks)');
  
      setIsRecording(true);
      setStatus('🔴 RECORDING - Speak now!');
      setTranscript('');
  
    } catch (err) {
      addLog(`❌ ${err.name}: ${err.message}`);
      
      let userMessage = err.name;
      if (err.name === 'NotAllowedError') {
        userMessage = 'Permission denied';
      } else if (err.name === 'NotFoundError') {
        userMessage = 'No microphone found';
      }
      
      setStatus(`❌ ${userMessage}`);
    }
  };

  const stopRecording = () => {
    addLog('📍 stopRecording() called');
    
    if (!mediaRecorderRef.current || !isRecording) {
      addLog('Nothing to stop');
      return;
    }

    // Stop MediaRecorder
    addLog('Stopping MediaRecorder...');
    const recorder = mediaRecorderRef.current;
    
    // Use stop event to ensure all chunks are sent
    recorder.addEventListener('stop', () => {
      addLog('MediaRecorder stopped event fired');
      
      // Wait a bit for final chunks to be sent, then send stop signal
      setTimeout(() => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
          addLog('📤 Sending stop signal to server...');
          websocketRef.current.send(JSON.stringify({
            action: 'stop_recording'
          }));
        } else {
          addLog('⚠️ Cannot send stop signal - WebSocket not open');
        }
      }, 500); // Increased to 500ms to ensure all chunks are sent
    }, { once: true });
    
    recorder.stop();
    mediaRecorderRef.current = null;
    
    setIsRecording(false);
    setIsProcessing(true);
    setStatus('⏳ Processing... (transcribing & generating response)');
  };

  return (
    <div style={{ 
      textAlign: 'center', 
      padding: '30px', 
      fontFamily: 'Arial',
      maxWidth: '1000px',
      margin: '0 auto',
      backgroundColor: '#fafafa',
      minHeight: '100vh'
    }}>
      <h1>🎙️ Voice Recording with Transcription</h1>
      
      {/* Status Cards */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ 
          padding: '10px 20px',
          backgroundColor: wsConnected ? '#4caf50' : '#f44336',
          color: 'white',
          borderRadius: '8px',
          fontWeight: 'bold'
        }}>
          WebSocket: {wsConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
        <div style={{ 
          padding: '10px 20px',
          backgroundColor: isRecording ? '#ff9800' : isProcessing ? '#2196f3' : '#9e9e9e',
          color: 'white',
          borderRadius: '8px',
          fontWeight: 'bold'
        }}>
          {isRecording ? '🔴 Recording' : isProcessing ? '⏳ Processing' : '⚪ Ready'}
        </div>
      </div>

      <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '20px 0', minHeight: '24px' }}>
        {status}
      </p>

      {/* Transcript Display */}
      {transcript && (
        <div style={{
          marginBottom: '20px',
          padding: '20px',
          backgroundColor: '#e3f2fd',
          borderRadius: '8px',
          border: '2px solid #2196f3'
        }}>
          <strong style={{ fontSize: '18px' }}>📝 Transcript:</strong>
          <p style={{ 
            marginTop: '10px', 
            fontSize: '16px',
            fontStyle: 'italic',
            color: '#333'
          }}>
            "{transcript}"
          </p>
        </div>
      )}

      {/* Record Button */}
      <div style={{ marginBottom: '30px' }}>
        <button
          onClick={handleButtonClick}
          disabled={(!wsConnected && !isRecording) || isProcessing}
          style={{
            padding: '20px 40px',
            fontSize: '18px',
            backgroundColor: isRecording ? '#ff4444' : isProcessing ? '#cccccc' : wsConnected ? '#44ff44' : '#cccccc',
            color: 'white',
            border: 'none',
            borderRadius: '50px',
            cursor: (wsConnected || isRecording) && !isProcessing ? 'pointer' : 'not-allowed',
            opacity: (wsConnected || isRecording) && !isProcessing ? 1 : 0.6,
            fontWeight: 'bold',
            transition: 'all 0.2s',
            boxShadow: (isRecording || wsConnected) && !isProcessing ? '0 4px 6px rgba(0,0,0,0.1)' : 'none'
          }}
        >
          {isRecording ? '⏹️ STOP & TRANSCRIBE' : isProcessing ? '⏳ PROCESSING...' : '🎙️ START RECORDING'}
        </button>
      </div>

      {/* Conversation History */}
      {recordings.length > 0 && (
        <div style={{
          marginBottom: '20px',
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'left'
        }}>
          <strong style={{ fontSize: '16px' }}>💬 Conversation History ({recordings.length}):</strong>
          <div style={{ marginTop: '15px' }}>
            {recordings.slice().reverse().map((rec, i) => (
              <div key={i} style={{ 
                padding: '15px',
                marginBottom: '15px',
                backgroundColor: '#f5f5f5',
                borderRadius: '8px',
                borderLeft: '4px solid #4caf50'
              }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                  🕐 {rec.time}
                </div>
                
                {/* User message */}
                <div style={{ 
                  marginBottom: '10px',
                  padding: '10px',
                  backgroundColor: '#e3f2fd',
                  borderRadius: '6px'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1976d2', marginBottom: '5px' }}>
                    👤 You:
                  </div>
                  <div style={{ fontSize: '14px', fontStyle: 'italic' }}>
                    "{rec.transcript}"
                  </div>
                </div>
                
                {/* AI Response */}
                {rec.response && (
                  <div style={{ 
                    padding: '10px',
                    backgroundColor: '#e8f5e9',
                    borderRadius: '6px'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#388e3c', marginBottom: '5px' }}>
                      🤖 AI Response:
                    </div>
                    <button
                      onClick={() => playResponseAudio(rec.response, 'wav')}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      ▶️ Play Response Audio
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debug Log */}
      <div style={{ 
        padding: '20px',
        backgroundColor: 'white',
        borderRadius: '8px',
        textAlign: 'left',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <strong style={{ fontSize: '16px' }}>🔍 Debug Log:</strong>
        <div style={{ 
          fontFamily: 'Consolas, monospace', 
          fontSize: '12px',
          marginTop: '10px',
          maxHeight: '200px',
          overflow: 'auto',
          backgroundColor: '#f5f5f5',
          padding: '15px',
          borderRadius: '4px'
        }}>
          {debugLog.length === 0 ? (
            <div style={{ color: '#999' }}>No logs yet...</div>
          ) : (
            debugLog.map((log, i) => (
              <div key={i} style={{ 
                padding: '4px 0', 
                borderBottom: i < debugLog.length - 1 ? '1px solid #e0e0e0' : 'none'
              }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Instructions */}
      <div style={{ 
        marginTop: '20px', 
        padding: '15px',
        backgroundColor: '#fff3e0',
        borderRadius: '8px',
        fontSize: '13px',
        textAlign: 'left'
      }}>
        <strong>📋 How it works:</strong>
        <ol style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li><strong>Click "START RECORDING"</strong> - Begin recording your voice</li>
          <li><strong>Speak clearly</strong> - Audio is streamed to server in real-time</li>
          <li><strong>Click "STOP & TRANSCRIBE"</strong> - Server will:
            <ul style={{ marginTop: '5px', fontSize: '12px' }}>
              <li>Save your recording as WAV file</li>
              <li>Transcribe speech to text using Google Speech Recognition</li>
              <li>Generate an audio response using text-to-speech</li>
              <li>Send transcript and play the response audio</li>
            </ul>
          </li>
        </ol>
        <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#fff', borderRadius: '4px', fontSize: '12px' }}>
          <strong>💡 Note:</strong> Requires internet connection for speech recognition and text-to-speech services.
        </div>
      </div>
    </div>
  );
}

export default App;