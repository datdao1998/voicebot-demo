import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Initializing...');
  const [wsConnected, setWsConnected] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const [clickCount, setClickCount] = useState(0);
  const [savedRecordings, setSavedRecordings] = useState([]);
  
  const mediaRecorderRef = useRef(null);
  const websocketRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef(null);
  const shouldReconnectRef = useRef(true); // Control auto-reconnect

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
    let ws = null;
  
    if (!mountedRef.current) return;

    addLog('🔄 Creating WebSocket connection...');
    
    try {
      ws = new WebSocket('ws://localhost:8000/ws');
    } catch (err) {
      addLog(`❌ Failed to create WebSocket: ${err.message}`);
      if (mountedRef.current) {
        setStatus('WebSocket creation failed');
        setWsConnected(false);
      }
      return;
    }

    ws.onopen = () => {
      if (!mountedRef.current) return;
      addLog('✅ WebSocket CONNECTED');
      setStatus('Connected – Ready to stream');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      addLog(`📨 Received ${event.data.size} bytes`);
      const audioBlob = new Blob([event.data], { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play().catch(e => addLog(`Audio error: ${e.message}`));
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      addLog('❌ WebSocket ERROR');
      setStatus('Connection error');
      setWsConnected(false);
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      addLog(`🔌 WebSocket CLOSED (code: ${event.code})`);
      
      // Check if this was a manual close (for saving) or an error
      if (event.code === 1000) {
        // Normal closure - recording was saved
        addLog('💾 Backend is saving your recording as WAV...');
        setStatus('✅ Recording saved on server!');
        
        const timestamp = new Date().toLocaleTimeString();
        setSavedRecordings(prev => [...prev, `Recording at ${timestamp}`]);
      } else {
        setStatus('Disconnected – Retrying in 3s...');
      }
      
      setWsConnected(false);
      websocketRef.current = null;
      
      // Only auto-reconnect if we should (not during manual stop)
      if (shouldReconnectRef.current && event.code !== 1000) {
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current && shouldReconnectRef.current) {
            connectWebSocket();
          }
        }, 3000);
      }
    };

    websocketRef.current = ws;
  }, [addLog]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      addLog('Cleaning up WebSocket...');
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
    console.log('MAIN BUTTON CLICKED!');
    const newCount = clickCount + 1;
    setClickCount(newCount);
    addLog(`🖱️ MAIN clicked (${newCount})`);
    addLog(`State: recording=${isRecording}, ws=${wsConnected}`);
    
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
      addLog('Already recording - exit');
      return;
    }

    // Ensure WebSocket is connected
    if (!wsConnected) {
      addLog('❌ WebSocket not connected - attempting to connect...');
      connectWebSocket();
      
      // Wait a moment for connection
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (!wsConnected) {
        setStatus('❌ Cannot connect to server');
        return;
      }
    }
  
    addLog('Requesting microphone...');
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
      
      addLog(`✅ Microphone granted! Tracks: ${stream.getAudioTracks().length}`);
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
          addLog(`📦 Chunk ${chunkCount}: ${event.data.size}b`);
          
          if (websocketRef.current?.readyState === WebSocket.OPEN) {
            try {
              websocketRef.current.send(event.data);
              addLog(`✅ Sent chunk ${chunkCount}`);
            } catch (err) {
              addLog(`❌ Send error: ${err.message}`);
            }
          } else {
            addLog(`❌ WS not open (state: ${websocketRef.current?.readyState})`);
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
  
      mediaRecorder.start(250); // 250ms chunks
      addLog('MediaRecorder.start() called (250ms chunks)');
  
      setIsRecording(true);
      setStatus('🔴 RECORDING - Speak now!');
      addLog('✅ Recording and streaming to server');
  
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

    // Stop the MediaRecorder
    addLog('Stopping MediaRecorder...');
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    
    // Close WebSocket to trigger backend save
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      addLog('🔌 Closing WebSocket to save recording...');
      shouldReconnectRef.current = false; // Prevent auto-reconnect
      websocketRef.current.close(1000, 'Recording complete'); // Normal closure
      addLog('✅ WebSocket closed - backend will save WAV file');
    }
    
    setIsRecording(false);
    setStatus('⏳ Saving recording...');
    addLog('Recording session ended');
    
    // Re-enable auto-reconnect after a delay and reconnect
    setTimeout(() => {
      shouldReconnectRef.current = true;
      if (mountedRef.current) {
        addLog('Reconnecting WebSocket for next session...');
        connectWebSocket();
      }
    }, 2000);
  };

  return (
    <div style={{ 
      textAlign: 'center', 
      padding: '30px', 
      fontFamily: 'Arial',
      maxWidth: '900px',
      margin: '0 auto',
      backgroundColor: '#fafafa',
      minHeight: '100vh'
    }}>
      <h1>🎙️ Voice Recording & Streaming</h1>
      
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
          backgroundColor: isRecording ? '#ff9800' : '#9e9e9e',
          color: 'white',
          borderRadius: '8px',
          fontWeight: 'bold'
        }}>
          Recording: {isRecording ? '🔴 ON' : '⚪ OFF'}
        </div>
      </div>

      <p style={{ fontSize: '16px', fontWeight: 'bold', margin: '20px 0', minHeight: '24px' }}>
        {status}
      </p>

      {/* Saved recordings list */}
      {savedRecordings.length > 0 && (
        <div style={{
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: '#e8f5e9',
          borderRadius: '8px',
          border: '2px solid #4caf50'
        }}>
          <strong>💾 Saved Recordings ({savedRecordings.length}):</strong>
          <div style={{ marginTop: '10px', fontSize: '14px' }}>
            {savedRecordings.map((recording, i) => (
              <div key={i} style={{ padding: '5px 0' }}>
                ✅ {recording}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
            Check your backend <code>recordings/</code> folder for WAV files
          </div>
        </div>
      )}

      <div style={{ marginBottom: '30px' }}>
        <button
          onClick={handleButtonClick}
          disabled={!wsConnected && !isRecording}
          style={{
            padding: '20px 40px',
            fontSize: '18px',
            backgroundColor: isRecording ? '#ff4444' : wsConnected ? '#44ff44' : '#cccccc',
            color: 'white',
            border: 'none',
            borderRadius: '50px',
            cursor: wsConnected || isRecording ? 'pointer' : 'not-allowed',
            opacity: wsConnected || isRecording ? 1 : 0.6,
            fontWeight: 'bold',
            transition: 'all 0.2s',
            boxShadow: isRecording || wsConnected ? '0 4px 6px rgba(0,0,0,0.1)' : 'none'
          }}
        >
          {isRecording ? '⏹️ STOP & SAVE RECORDING' : '🎙️ START RECORDING'}
        </button>
        <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
          Button clicks: {clickCount}
        </div>
      </div>

      <div style={{ 
        padding: '20px',
        backgroundColor: 'white',
        borderRadius: '8px',
        textAlign: 'left',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <strong style={{ fontSize: '16px' }}>🔍 Debug Log (last 10):</strong>
        <div style={{ 
          fontFamily: 'Consolas, monospace', 
          fontSize: '12px',
          marginTop: '10px',
          maxHeight: '300px',
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
          <li><strong>Click "START RECORDING"</strong> - Connects to server and starts streaming audio</li>
          <li><strong>Speak into microphone</strong> - Audio chunks sent every 250ms</li>
          <li><strong>Click "STOP & SAVE"</strong> - Closes connection and triggers backend to:
            <ul style={{ marginTop: '5px', fontSize: '12px' }}>
              <li>Combine all audio chunks</li>
              <li>Convert WebM to WAV format</li>
              <li>Save to <code>recordings/recording_YYYYMMDD_HHMMSS.wav</code></li>
            </ul>
          </li>
          <li>WebSocket automatically reconnects for next recording</li>
        </ol>
      </div>
    </div>
  );
}

export default App;