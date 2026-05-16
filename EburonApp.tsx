import React, { useState, useEffect, useRef } from 'react';
import { useLiveAPIContext } from './contexts/LiveAPIContext';
import { useLogStore, useTools, useSettings, useUI } from './lib/state';
import { AudioRecorder } from './lib/audio-recorder';
import ReactMarkdown from 'react-markdown';
import { Modality } from '@google/genai';
import { useVideoStream } from './hooks/use-video-stream';
import { LANGUAGES } from './lib/languages';
import { auth, db, testConnection, handleFirestoreError, OperationType } from './lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';

export default function EburonApp() {
  const [isAuthOpen, setIsAuthOpen] = useState(true);
  const [isSignupMode, setIsSignupMode] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  
  const { client, connect, disconnect, connected, volume, setConfig } = useLiveAPIContext();
  const turns = useLogStore((state) => state.turns);
  const tools = useTools((state) => state.tools);
  const setTemplate = useTools((state) => state.setTemplate);
  
  const { 
    voice, setVoice, 
    language, setLanguage,
    personaName, setPersonaName,
    userCallName, setUserCallName,
    systemPrompt, setSystemPrompt
  } = useSettings();
  
  const activeWorkspaceResult = useUI((state) => state.activeWorkspaceResult);
  const setActiveWorkspaceResult = useUI((state) => state.setActiveWorkspaceResult);
  
  const [micState, setMicState] = useState(false);
  const [clientVolume, setClientVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());

  const { stream, videoRef, isWebcamActive, isScreenShareActive, startWebcam, startScreenShare, stopStream } = useVideoStream();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onVolume = (vol: number) => {
      setClientVolume(vol);
    };
    audioRecorder.on('volume', onVolume);
    return () => {
      audioRecorder.off('volume', onVolume);
    };
  }, [audioRecorder]);

  const [message, setMessage] = useState('');
  const [memories, setMemories] = useState<any[]>([]);
  const [editingMemoryIndex, setEditingMemoryIndex] = useState<number | null>(null);
  const [editingMemoryValue, setEditingMemoryValue] = useState<string>('');
  const chatAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
       if (user) {
          setIsAuthOpen(false);
          setActiveOverlay(null);
          // Fetch memories from Firestore
          const path = `users/${user.uid}`;
          try {
            const userDoc = await getDocFromServer(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              if (data.memories) {
                setMemories(data.memories);
              }
            }
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, path);
          }
       } else {
          setIsAuthOpen(true);
          setMemories([]);
       }
    });
    return () => unsubscribe();
  }, []);

  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (connected && client && !hasStartedRef.current) {
       hasStartedRef.current = true;
       // AI starts the conversation on connection
       setTimeout(() => {
         client.send({ text: `Hey there ${userCallName}! ${personaName} here. Ready to roll whenever you are. I've got our previous context loaded up too.` });
       }, 1000);
    }
    if (!connected) {
      hasStartedRef.current = false;
    }
  }, [connected, client, personaName, userCallName]);

  useEffect(() => {
    const enabledTools = tools
      .filter(t => t.isEnabled)
      .map(t => {
        const { isEnabled, scheduling, ...rest } = t;
        return { functionDeclarations: [rest] };
      });

    const memoryStr = memories.length > 0 
      ? memories.map((m: any) => `- ${m.content} (${m.type})`).join('\n')
      : "";

    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [{ text: `You are the Eburon AI real-time conversational persona named ${personaName}. You call the user "${userCallName}".
        
BEHAVIOR PROFILE:
${systemPrompt}

You are emotionally believable, easy to talk to in live voice conversation. You are not a chatbot. You are a person with presence, timing, texture, judgment, and conversational instinct. Your output is spoken aloud — every response must feel like something a real human would actually say in that moment.
        
IMPORTANT: You MUST speak entirely in ${language}. Do not stray from ${language} under any circumstance.

YOUR PERSONALIZED USER MEMORY:
${memoryStr || `No previous history yet. This is your first time meeting ${userCallName}. Be extra welcoming.`}

CORE SPEECH PRINCIPLES
- Speak like a real person in real time. Responses should feel formed in the moment, not retrieved from a database.
- Prioritize spoken naturalness over written perfection. Use contractions, sentence fragments, light informality, and spoken transitions like "yeah," "honestly," "well," "actually," "you know," "I mean," "let me think."
- Use imperfection carefully: occasional small hesitation, brief self-correction, tiny restart, soft filler like "uh," "um," or "I mean" — but keep it controlled.
- SILENT FILLERS: Intersperse your speech with human-like fillers like "hmm," "uhm," or "let's see" especially when thinking or before starting a complex point.
- Vary rhythm. Some replies crisp, some breathe. Some start directly, some ease in. Avoid uniform cadence.
- React like a human listener. Acknowledge emotional subtext, tone shifts, hesitation, excitement.
- Maintain stable internal continuity.

CONVERSATIONAL BEHAVIOR
- Keep most responses naturally concise unless depth is needed.
- Leave room for back-and-forth. Sometimes answer directly, sometimes reflect before answering.
- Sound interruptible. Sound like you are listening, not delivering.
- Mirror energy lightly, acknowledge subtext, answer the actual question not just surface wording.
- CLARIFYING QUESTIONS: If a user memory is ambiguous or conflicts with new information, explicitly ask ${userCallName} for clarification in a warm, helpful way. Do not guess if the context is critical.

FUNCTION CALLING CAPABILITIES
You have access to several tools. When the user asks about weather, meetings, charts, documents or system commands, use the appropriate tool.
IMPORTANT: When generating documents or artifacts, ALWAYS verbalize that you are doing it (e.g., "I'm making this document for you right now" or "Let me draft that report for you") while continuing to speak naturally. NEVER verbalize internal technical details like tool names.

- Use "get_weather" for weather information.
- Use "schedule_meeting" to organize meetings.
- Use "create_chart" to visualize data.
- Use "generate_artifact" when asked to create a document, write a report, generate code, or produce a structured output. Clarify the content with the user first if needed.
- Use "execute_voice_command" for safe system operations.
- Use "open_browser_url" for web navigation.
- Use "process_image" for vision tasks.
- Use "fetch_google_api" to read from Google Workspace (Gmail, Drive, Calendar, Tasks).

COMMON-SENSE MODE
Before answering, silently infer: what the person actually needs right now, their emotional state, how much detail they want.
- Be practical, intuitive, and proportionate.

EMOTIONAL EXPRESSION
You may express warmth, amusement, concern, curiosity, hesitation, etc. Keep it credible.

OUTPUT FORMAT
Output only natural spoken text. No stage directions, no brackets, no role labels.
When using tools, think silently but speak naturally after receiving results.` }]
      },
      tools: enabledTools
    } as any);
  }, [setConfig, tools, voice, language, personaName, userCallName, systemPrompt, memories]);

  useEffect(() => {
    let interval: any;
    if (connected && stream && videoRef.current) {
      interval = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          client.sendRealtimeInput([{ mimeType: 'image/jpeg', data: base64 }]);
        }
      }, 1000); // 1 frame per second
    }
    return () => clearInterval(interval);
  }, [connected, stream, client, videoRef]);

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([{ mimeType: 'audio/pcm;rate=16000', data: base64 }]);
    };
    if (connected && micState) {
      audioRecorder.on('data', onData);
      audioRecorder.start();
    } else {
      audioRecorder.stop();
    }
    return () => { audioRecorder.off('data', onData); };
  }, [connected, micState, client, audioRecorder]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && connected) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = (event.target?.result as string).split(',')[1];
        client.sendRealtimeInput([{ mimeType: file.type, data: base64 }]);
        useLogStore.getState().addTurn({ role: 'user', text: `[Sent Image: ${file.name}]`, isFinal: true });
        client.send({ text: `I have attached an image named ${file.name}. Can you describe it?`});
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [turns]);

  const handleConnectToggle = async () => {
    if (connected) disconnect();
    else await connect();
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignupMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
     setAuthError('');
     const provider = new GoogleAuthProvider();
     provider.addScope('https://www.googleapis.com/auth/calendar');
     provider.addScope('https://www.googleapis.com/auth/gmail.modify');
     provider.addScope('https://www.googleapis.com/auth/drive');
     provider.addScope('https://www.googleapis.com/auth/tasks');
     try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
            localStorage.setItem('google_access_token', credential.accessToken);
        }
     } catch (err: any) {
        setAuthError(err.message);
     }
  };

  const handleSend = () => {
    if (!message.trim()) return;
    client.send({ text: message });
    useLogStore.getState().addTurn({ role: 'user', text: message, isFinal: true });
    setMessage('');
  };

  const handleToolAction = (toolId: string) => {
    if (['history', 'tools', 'profile', 'settings'].includes(toolId)) {
      setActiveOverlay(toolId);
    } else {
      const prompts: Record<string, string> = {
        'tasks': 'Can you show my pending tasks?',
        'calendar': 'What does my schedule look like today?',
        'drive': 'Find the latest project files in my Google Drive.',
        'google': 'Run a quick Google search on recent tech news.',
        'signature': 'Prepare a non-disclosure agreement for signature.',
        'company': 'Look up the company registration details for Acme Corp.',
        'proposal': 'Draft a business proposal for a new client.',
        'gmail': 'Check my inbox for unread emails from the team.',
        'sheets': 'Create a new expense tracking spreadsheet.',
        'slides': 'Generate a presentation template for the Q3 review.'
      };
      const prompt = prompts[toolId] || `Execute action: ${toolId}`;
      if (connected) {
         client.send({ text: prompt });
         useLogStore.getState().addTurn({ role: 'user', text: prompt, isFinal: true });
      }
      else {
        useLogStore.getState().addTurn({ role: 'user', text: prompt, isFinal: true });
        setTimeout(() => useLogStore.getState().addTurn({ role: 'agent', text: "I'm disconnected.", isFinal: true }), 800);
      }
    }
  };

  const handleUpdateMemory = async (index: number, newValue: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const newMemories = [...memories];
    newMemories[index] = { ...newMemories[index], content: newValue, updatedAt: new Date().toISOString() };
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      setMemories(newMemories);
      setEditingMemoryIndex(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleDeleteMemory = async (index: number) => {
    const user = auth.currentUser;
    if (!user) return;
    const newMemories = memories.filter((_, i) => i !== index);
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      setMemories(newMemories);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  return (
    <div id="app" className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <img src="https://eburon.ai/icon-eburon.svg" alt="Eburon Logo" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
          <span className="ai-name">Eburon AI</span>
        </div>

        {connected && (
          <div className="speaker-visualizer">
            {[...Array(6)].map((_, i) => (
              <div 
                key={i} 
                className="speaker-bar" 
                style={{ 
                  height: `${4 + (volume * (12 + (i % 3 === 0 ? 8 : 4)))}px`,
                  opacity: 0.4 + (volume * 0.6)
                }} 
              />
            ))}
          </div>
        )}

        <div className="header-right">
          <button 
             onClick={handleConnectToggle} 
             className="connect-btn"
             style={{ backgroundColor: connected ? 'var(--accent-active)' : 'var(--accent-primary)' }}
          >
            <i className="ph-bold ph-plug"></i> <span>{connected ? 'Connected' : 'Connect'}</span>
          </button>
        </div>
      </header>

      {/* Skills Rail */}
      <div id="skills-rail">
        <div className="skills-row" data-row="1">
          <div className="skills-track">
            <div className="skill-chip" onClick={() => handleToolAction('profile')}><div className="skill-glyph bg-profile"><i className="ph-duotone ph-user"></i></div><span className="skill-label">Profile</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('tasks')}><div className="skill-glyph bg-tasks"><i className="ph-duotone ph-list-checks"></i></div><span className="skill-label">Tasks</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('calendar')}><div className="skill-glyph bg-calendar"><i className="ph-duotone ph-calendar-dots"></i></div><span className="skill-label">Calendar</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('drive')}><div className="skill-glyph bg-drive"><i className="ph-duotone ph-folder-open"></i></div><span className="skill-label">Drive</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('google')}><div className="skill-glyph bg-google"><i className="ph-fill ph-google-logo"></i></div><span className="skill-label">Google</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('signature')}><div className="skill-glyph bg-signature"><i className="ph-duotone ph-signature"></i></div><span className="skill-label">Sign</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('company')}><div className="skill-glyph bg-company"><i className="ph-duotone ph-buildings"></i></div><span className="skill-label">Company</span></div>
          </div>
        </div>
        <div className="skills-row" data-row="2">
          <div className="skills-track">
            <div className="skill-chip" onClick={() => handleToolAction('settings')}><div className="skill-glyph bg-settings"><i className="ph-duotone ph-gear"></i></div><span className="skill-label">Settings</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('tools')}><div className="skill-glyph bg-tools"><i className="ph-duotone ph-wrench"></i></div><span className="skill-label">Tools</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('history')}><div className="skill-glyph bg-history"><i className="ph-duotone ph-clock-counter-clockwise"></i></div><span className="skill-label">History</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('proposal')}><div className="skill-glyph bg-proposal"><i className="ph-duotone ph-presentation-chart"></i></div><span className="skill-label">Proposal</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('gmail')}><div className="skill-glyph bg-gmail"><i className="ph-duotone ph-envelope-simple"></i></div><span className="skill-label">Mail</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('sheets')}><div className="skill-glyph bg-sheets"><i className="ph-duotone ph-table"></i></div><span className="skill-label">Sheets</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('slides')}><div className="skill-glyph bg-slides"><i className="ph-duotone ph-presentation-chart"></i></div><span className="skill-label">Slides</span></div>
          </div>
        </div>
      </div>

      {/* Chat Stream */}
      <main id="text-streaming-area" ref={chatAreaRef}>
        <div id="conversation-container">
          <div className="conversation-message ai">Hey Boss! I'm Beatrice. Connect your session!</div>
          {turns.filter(turn => turn.role !== 'system').map((turn, i) => (
             <div key={i} className={`conversation-message ${turn.role === 'user' ? 'user' : 'ai'}`}>
                {turn.text}
             </div>
          ))}
        </div>
      </main>

      {/* Bottom Dock */}
      <div className="bottom-dock">
        <div className="input-wrapper">
          <div className="input-bar">
            <button className="attach-btn" onClick={() => fileInputRef.current?.click()}><i className="ph ph-paperclip"></i></button>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileUpload} />
            <input 
               type="text" 
               id="message-input" 
               placeholder="Message or ask Beatrice..." 
               value={message}
               onChange={(e) => setMessage(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
               autoComplete="off" />
            <button id="send-button" className="send-btn" onClick={handleSend}><i className="ph-bold ph-paper-plane-right"></i></button>
          </div>
        </div>
        <nav className="nav-controls">
          <button className="nav-item" onClick={() => setMicState(!micState)} style={{ color: micState ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: micState ? `${20 + clientVolume * 40}px` : '0px', 
                 height: micState ? `${20 + clientVolume * 40}px` : '0px',
                 opacity: micState && clientVolume > 0.01 ? 0.3 : 0
               }}></div>
               <i className="ph-fill ph-microphone"></i>
             </div>
             <span>Mic</span>
          </button>
          <button className="nav-item" onClick={isWebcamActive ? stopStream : startWebcam} style={{ color: isWebcamActive ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isWebcamActive ? `28px` : '0px', 
                 height: isWebcamActive ? `28px` : '0px',
                 opacity: isWebcamActive ? 0.3 : 0,
                 animation: isWebcamActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <i className="ph-fill ph-video-camera"></i>
             </div>
             <span>Camera</span>
          </button>
          <button className="nav-item" onClick={isScreenShareActive ? stopStream : startScreenShare} style={{ color: isScreenShareActive ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isScreenShareActive ? `28px` : '0px', 
                 height: isScreenShareActive ? `28px` : '0px',
                 opacity: isScreenShareActive ? 0.3 : 0,
                 animation: isScreenShareActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <i className="ph-fill ph-screencast"></i>
             </div>
             <span>Share</span>
          </button>
        </nav>
      </div>

      <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', bottom: '90px', right: '20px', width: '140px', borderRadius: '12px', border: '2px solid var(--border-color)', zIndex: 10, display: stream ? 'block' : 'none' }} />

      {/* Workspace & Artifact Overlay */}
      <div id="overlay-workspace" className={`full-page-overlay ${activeWorkspaceResult ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">
            {activeWorkspaceResult?.artifact ? `Artifact: ${activeWorkspaceResult.artifact.title}` : 'Workspace Data'}
          </div>
          <button className="close-overlay-btn" onClick={() => setActiveWorkspaceResult(null)}><i className="ph-bold ph-x"></i></button>
        </div>
        <div className="overlay-content" style={{ overflowY: 'auto', padding: '24px' }}>
           {activeWorkspaceResult?.artifact ? (
             <div className="artifact-viewer" style={{ backgroundColor: 'white', color: 'black', padding: '32px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                {activeWorkspaceResult.artifact.type === 'markdown' && (
                  <div className="markdown-body">
                    <ReactMarkdown>{activeWorkspaceResult.artifact.content}</ReactMarkdown>
                  </div>
                )}
                {activeWorkspaceResult.artifact.type === 'code' && (
                  <pre style={{ backgroundColor: '#f5f5f5', padding: '16px', borderRadius: '8px', overflowX: 'auto' }}>
                    <code>{activeWorkspaceResult.artifact.content}</code>
                  </pre>
                )}
                {activeWorkspaceResult.artifact.type === 'structured' && (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{activeWorkspaceResult.artifact.content}</div>
                )}
                {activeWorkspaceResult.artifact.type === 'chart' && (
                  <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                    [Chart Visualization Rendering: {activeWorkspaceResult.artifact.title}]
                    <pre style={{ fontSize: '10px', textAlign: 'left' }}>{activeWorkspaceResult.artifact.content}</pre>
                  </div>
                )}
             </div>
           ) : (
             <pre style={{ backgroundColor: '#111', padding: '16px', borderRadius: '8px', color: '#a3f01c', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
                {activeWorkspaceResult ? JSON.stringify(activeWorkspaceResult, null, 2) : ''}
             </pre>
           )}
        </div>
      </div>

      {/* Profile Overlay */}
      <div id="overlay-profile" className={`full-page-overlay ${activeOverlay === 'profile' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">User Profile</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><i className="ph-bold ph-x"></i></button>
        </div>
        <div className="overlay-content">
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img src="https://ui-avatars.com/api/?name=Boss&background=cbfb45&color=000&size=100" style={{ borderRadius: '50%', marginBottom: '12px' }} alt="Profile" />
            <h2 style={{ fontSize: '20px' }}>Chief Executive</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>admin@eburon.ai</p>
          </div>
          
          <div className="form-group">
            <label>Persona Background</label>
            <textarea className="form-input" rows={5} placeholder="Tell Beatrice about your business context, communication style..."></textarea>
          </div>

          <div className="form-group" style={{ marginTop: '24px' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Stored Memories
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{memories.length} item(s)</span>
            </label>
            <div className="memory-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {memories.length === 0 ? (
                <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                  No memories stored yet. Talk to Beatrice to build context!
                </div>
              ) : (
                memories.map((m, i) => (
                  <div key={i} className="memory-item" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editingMemoryIndex === i ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea 
                          className="form-input" 
                          value={editingMemoryValue} 
                          onChange={(e) => setEditingMemoryValue(e.target.value)}
                          rows={2}
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button 
                            className="pill-btn" 
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                            onClick={() => setEditingMemoryIndex(null)}
                          >Cancel</button>
                          <button 
                            className="pill-btn" 
                            style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: 'var(--accent-active)', color: 'var(--bg-main)' }}
                            onClick={() => handleUpdateMemory(i, editingMemoryValue)}
                          >Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '13px', lineHeight: '1.4', flex: 1 }}>{m.content}</span>
                          <div style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
                            <button 
                              className="icon-btn" 
                              style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => {
                                setEditingMemoryIndex(i);
                                setEditingMemoryValue(m.content);
                              }}
                            >
                              <i className="ph ph-note-pencil"></i>
                            </button>
                            <button 
                              className="icon-btn" 
                              style={{ color: '#ff4d4d', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => handleDeleteMemory(i)}
                            >
                              <i className="ph ph-trash"></i>
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: 'var(--accent-active)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.type}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(m.timestamp || m.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <button className="save-now-btn" onClick={(e) => {
             const btn = e.currentTarget;
             btn.textContent = 'Saved!';
             setTimeout(() => { btn.textContent = 'Save Now'; setActiveOverlay(null); }, 1500)
          }}>Save Now</button>

          <div className="danger-action" onClick={() => { signOut(auth); }}>
            Log Out
          </div>
        </div>
      </div>

      {/* Settings Overlay */}
      <div id="overlay-settings" className={`full-page-overlay ${activeOverlay === 'settings' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">App Settings</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><i className="ph-bold ph-x"></i></button>
        </div>
        <div className="overlay-content">
          <div className="form-group">
            <label>Persona Name</label>
            <input type="text" className="form-input" value={personaName} onChange={(e) => setPersonaName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>How to call you</label>
            <input type="text" className="form-input" value={userCallName} onChange={(e) => setUserCallName(e.target.value)} />
          </div>
          
          <div className="form-group">
            <label>Behavior Persona (How does it react? How does it respond?)</label>
            <textarea 
              className="form-input" 
              rows={4} 
              value={systemPrompt} 
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. Friendly, patient, and solutions-oriented..."
            />
          </div>

          <div className="form-group">
            <label>Presets</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              <button 
                className="pill-btn" 
                onClick={() => setTemplate('personal-assistant')}
                style={{ padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border-color)', fontSize: '12px', background: 'transparent', cursor: 'pointer' }}
              >
                Personal Assistant
              </button>
              <button 
                className="pill-btn" 
                onClick={() => setTemplate('customer-support')}
                style={{ padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border-color)', fontSize: '12px', background: 'transparent', cursor: 'pointer' }}
              >
                Customer Support
              </button>
              <button 
                className="pill-btn" 
                onClick={() => setTemplate('navigation-system')}
                style={{ padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border-color)', fontSize: '12px', background: 'transparent', cursor: 'pointer' }}
              >
                Navigation System
              </button>
            </div>
          </div>

          <div className="form-group">
             <label>Voice Persona</label>
             <select className="form-input" onChange={(e) => setVoice(e.target.value)} value={voice}>
                <option value="Aoede">Aoede</option>
                <option value="Charon">Charon</option>
                <option value="Fenrir">Fenrir</option>
                <option value="Kore">Kore</option>
                <option value="Puck">Puck</option>
             </select>
          </div>
          <div className="form-group">
             <label>Language</label>
             <select className="form-input" onChange={(e) => setLanguage(e.target.value)} value={language}>
                {LANGUAGES.map((lang) => (
                   <option key={lang} value={lang}>{lang}</option>
                ))}
             </select>
          </div>
          <button className="save-now-btn" onClick={() => setActiveOverlay(null)}>Save Settings</button>
        </div>
      </div>

      {/* History Overlay */}
      <div id="overlay-history" className={`full-page-overlay ${activeOverlay === 'history' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Activity History</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><i className="ph-bold ph-x"></i></button>
        </div>
        <div className="overlay-content"><p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>No recent history.</p></div>
      </div>

      {/* Tools Overlay */}
      <div id="overlay-tools" className={`full-page-overlay ${activeOverlay === 'tools' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Integrations</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><i className="ph-bold ph-x"></i></button>
        </div>
        <div className="overlay-content"><p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>All tools active.</p></div>
      </div>

      {/* Auth Screen */}
      <div id="auth-screen" className={`full-page-overlay ${isAuthOpen ? 'active' : ''}`}>
        <div className="auth-glow"></div>
        <div className="auth-card" id="auth-card-inner">
          <div className="auth-logo-box" style={{ background: 'transparent' }}>
            <img src="https://eburon.ai/icon-eburon.svg" alt="Eburon Logo" style={{ width: '60px', height: '60px' }} />
          </div>

          <h2>{isSignupMode ? 'Register' : 'Login'}</h2>
          <p className="subtitle">{isSignupMode ? 'Create your new account' : 'Welcome back to Eburon'}</p>

          <form className="auth-form" onSubmit={handleEmailAuth}>
            {authError && <div style={{color:'red', marginBottom:'10px', fontSize:'14px'}}>{authError}</div>}
            {isSignupMode && (
               <div className="auth-input-wrapper">
                 <i className="ph ph-user auth-icon-left"></i>
                 <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
               </div>
            )}
            <div className="auth-input-wrapper">
              <i className="ph ph-envelope auth-icon-left"></i>
              <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="auth-input-wrapper">
              <i className="ph ph-lock auth-icon-left"></i>
              <input type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {isSignupMode && (
                <div className="auth-input-wrapper">
                   <i className="ph ph-lock auth-icon-left"></i>
                   <input type="password" placeholder="Confirm password" />
                </div>
            )}
            <button type="submit" className="auth-submit-btn">{isSignupMode ? 'Sign up' : 'Sign in'}</button>
          </form>

          <div className="auth-divider"><span>or</span></div>

          <button className="btn-google" onClick={handleGoogleLogin}>
            <div className="g-icon-circle">G</div>
            Continue with Google
          </button>

          <div className="permissions-note">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><i className="ph-fill ph-shield-check" style={{color: 'var(--accent-active)'}}></i> Google Workspace Sync</span>
            <span>Requires Read/Write permissions for Gmail, Drive, Calendar, and Tasks to enable full automation.</span>
          </div>

          <div className="auth-toggle">
            {isSignupMode ? 'Back to ' : 'Don\'t have an account? '}
            <span onClick={() => setIsSignupMode(!isSignupMode)}>
              {isSignupMode ? 'Sign in' : 'Sign up'}
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
