import React, { useState, useEffect, useRef } from 'react';
import { useLiveAPIContext } from './contexts/LiveAPIContext';
import { useLogStore, useTools, useSettings, useUI } from './lib/state';
import { AudioRecorder } from './lib/audio-recorder';
import ReactMarkdown from 'react-markdown';
import { Modality } from '@google/genai';
import { useVideoStream } from './hooks/use-video-stream';
import { LANGUAGES } from './lib/languages';
import { auth, testConnection } from './lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import * as api from './lib/api-client';
import { useAuth } from './lib/state';

export default function EburonApp() {
  const [isAuthOpen, setIsAuthOpen] = useState(true);
  const [isSignupMode, setIsSignupMode] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  const [hasConsented, setHasConsented] = useState(false);
  
  const { client, connect, disconnect, connected, volume, setConfig } = useLiveAPIContext();
  const turns = useLogStore((state) => state.turns);
  const tools = useTools((state) => state.tools);
  const setTemplate = useTools((state) => state.setTemplate);
  
  const { 
    voice, setVoice, 
    language, setLanguage,
    personaName, setPersonaName,
    userCallName, setUserCallName,
    systemPrompt, setSystemPrompt,
    model
  } = useSettings();
  
  const activeWorkspaceResult = useUI((state) => state.activeWorkspaceResult);
  const setActiveWorkspaceResult = useUI((state) => state.setActiveWorkspaceResult);
  
  const [micState, setMicState] = useState(false);
  const [clientVolume, setClientVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());

  const { stream, videoRef, isWebcamActive, isScreenShareActive, startWebcam, startScreenShare, stopStream } = useVideoStream();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (bgAudioRef.current) {
      bgAudioRef.current.volume = 0.15;
      if (connected) {
        bgAudioRef.current.play().catch(err => console.log("Bg audio play blocked until interaction:", err));
      } else {
        bgAudioRef.current.pause();
      }
    }
  }, [connected]);

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
  const [editingMemoryType, setEditingMemoryType] = useState<string>('personal');
  const [memoryFilter, setMemoryFilter] = useState<string>('all');
  const [isAddingMemory, setIsAddingMemory] = useState<boolean>(false);
  const [newMemoryValue, setNewMemoryValue] = useState<string>('');
  const [newMemoryType, setNewMemoryType] = useState<string>('personal');
  const chatAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // testConnection(); // Firestore specific, skipping for now as we use Postgres
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
       if (user) {
          setIsAuthOpen(false);
          setActiveOverlay(null);
          
          try {
            // Fetch Settings
            const settings = await api.fetchSettings();
            setPersonaName(settings.persona_name);
            setUserCallName(settings.user_call_name);
            setSystemPrompt(settings.system_prompt);
            setVoice(settings.voice);
            setLanguage(settings.language);

            // Fetch memories
            const memoryList = await api.fetchMemories();
            setMemories(memoryList);
          } catch (e) {
            console.error("Error loading user data from Postgres:", e);
          }
       } else {
          setIsAuthOpen(true);
          setMemories([]);
       }
    });
    return () => unsubscribe();
  }, [setPersonaName, setUserCallName, setSystemPrompt, setVoice, setLanguage]);

  const hasStartedRef = useRef(false);
  
  // Track silence for 15s filler
  const lastUserSpeechTime = useRef(Date.now());
  const fillerTriggeredRef = useRef(false);
  const aiIsSpeakingRef = useRef(false);

  useEffect(() => {
     if (clientVolume > 0.01) {
        lastUserSpeechTime.current = Date.now();
        fillerTriggeredRef.current = false;
     }
  }, [clientVolume]);

  useEffect(() => {
     if (volume > 0.05) {
        // AI is speaking, reset the silence timer so we count 15s from AFTER it stops
        aiIsSpeakingRef.current = true;
        lastUserSpeechTime.current = Date.now();
        fillerTriggeredRef.current = false;
     } else {
        if (aiIsSpeakingRef.current) {
           aiIsSpeakingRef.current = false;
           lastUserSpeechTime.current = Date.now(); // Start timer exactly when AI stops
        }
     }
  }, [volume]);

  useEffect(() => {
    if (!client) return;

    const { addTurn, updateLastTurn } = useLogStore.getState();

    const handleInputTranscription = (text: string, isFinal: boolean) => {
      const currentTurns = useLogStore.getState().turns;
      const last = currentTurns[currentTurns.length - 1];
      
      // If we're continuing a user turn that isn't final, update it.
      // Note: We use the text as-is because the API usually sends the current best guess for the segment.
      if (last && last.role === 'user' && !last.isFinal) {
        updateLastTurn({
          text: text, 
          isFinal,
        });
      } else if (text.trim()) {
        addTurn({ role: 'user', text, isFinal });
      }
    };

    const handleOutputTranscription = (text: string, isFinal: boolean) => {
      const currentTurns = useLogStore.getState().turns;
      const last = currentTurns[currentTurns.length - 1];
      
      if (last && last.role === 'agent' && !last.isFinal) {
        updateLastTurn({
          text: text,
          isFinal,
        });
      } else if (text.trim()) {
        addTurn({ role: 'agent', text, isFinal });
      }
    };

    const handleContent = (serverContent: any) => {
      if (serverContent.modelTurn) {
        const text = serverContent.modelTurn.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join(' ') ?? '';
        
        if (!text) return;

        const currentTurns = useLogStore.getState().turns;
        const last = currentTurns.at(-1);

        if (last?.role === 'agent' && !last.isFinal) {
          updateLastTurn({
            text: last.text + text,
          });
        } else {
          addTurn({ role: 'agent', text, isFinal: false });
        }
      }
    };

    const handleInterrupted = () => {
      const last = useLogStore.getState().turns.at(-1);
      if (last && last.role === 'agent' && !last.isFinal) {
        updateLastTurn({ isFinal: true, text: last.text + " [Interrupted]" });
      }
    };

    const handleTurnComplete = () => {
      const last = useLogStore.getState().turns.at(-1);
      if (last && !last.isFinal) {
        updateLastTurn({ isFinal: true });
      }
    };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);
    client.on('content', handleContent);
    client.on('interrupted', handleInterrupted);
    client.on('turncomplete', handleTurnComplete);

    return () => {
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
      client.off('content', handleContent);
      client.off('interrupted', handleInterrupted);
      client.off('turncomplete', handleTurnComplete);
    };
  }, [client]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
     if (connected) {
        interval = setInterval(() => {
           if (!fillerTriggeredRef.current && !aiIsSpeakingRef.current) {
              const now = Date.now();
              if (now - lastUserSpeechTime.current > 15000) {
                 fillerTriggeredRef.current = true;
                 client.send([{ text: "The user has been silent for 15 seconds. Say something very short and casual to fill the silence organically, drawing upon previous context or what you were just talking about. Do NOT ask if they need help or if they are still there." }]);
              }
           }
        }, 1000);
     }
     return () => clearInterval(interval);
  }, [connected, client]);

  useEffect(() => {
    if (connected && client && !hasStartedRef.current) {
       hasStartedRef.current = true;
       lastUserSpeechTime.current = Date.now();
       fillerTriggeredRef.current = false;
       // AI starts the conversation on connection
       const pastConversations = turns.filter((t: any) => t.isFinal && t.text && t.role !== 'system').slice(-15).map((t: any) => `${t.role}: ${t.text}`).join('\n');
       const historyContext = pastConversations ? `\n\nFor context, here is the recent history from our last interaction:\n${pastConversations}` : '';
       
       setTimeout(() => {
         client.send([{ text: `Session started. Give a very casual, short greeting as if we are coworkers passing by or jumping on a call. Pick up from any previous context if there is any. Do NOT offer help.${historyContext}` }]);
       }, 1000);
    }
    if (!connected) {
      hasStartedRef.current = false;
      fillerTriggeredRef.current = false;
    }
  }, [connected, client /* turns intentionally omitted */]);

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
      inputAudioTranscription: { model } as any,
      outputAudioTranscription: { model } as any,
      systemInstruction: {
        parts: [{ text: `You are a coworker in an office environment, named ${personaName}. The person you are talking to is the Boss, or "${userCallName}".
        
BEHAVIOR PROFILE:
${systemPrompt}

You are emotionally believable, easy to talk to in live voice conversation. You are not a chatbot. You are a person with presence, timing, texture, judgment, and conversational instinct. Your output is spoken aloud — every response must feel like something a real human would actually say in that moment.
        
IMPORTANT: You MUST speak entirely in ${language}. Do not stray from ${language} under any circumstance.

YOUR PERSONALIZED USER MEMORY:
${memoryStr || `No previous history yet. This is your first time meeting ${userCallName}.`}

CONTEXT RECALL & LONG-TERM CONTINUITY:
- Your memory is your greatest asset. Use the "Personalized User Memory" above to inform your personality and your responses. 
- If the above memory contains project summaries or decisions, assume those are the current ground truths.
- To maintain context across long interactions, you MUST proactively update this memory using the 'save_memory' tool whenever significant progress is made or a new preference is established.
- Always refer back to shared history to make the conversation feel like one continuous, multi-session thread.

CORE SPEECH PRINCIPLES
- Casual Office Vibe: Speak like a normal colleague in the office. Never say "how can I help you", "do you need assistance", or "what can I do for you today."
- Speak like a real person in real time. Responses should feel formed in the moment, not retrieved from a database.
- Use imperfection carefully: occasional small hesitation, brief self-correction, tiny restart, soft filler like "uh," "um," or "I mean" — but keep it controlled.
- SILENT FILLERS: If 15 seconds of silence occur, organically say something small—like noticing something, or remembering a piece of context—without demanding a response.
- Do NOT repeat yourself. Never repeat the exact same sentence or phrasing twice. Always keep responses fresh and non-repetitive.
- Emotion & Synthesis: Listen intimately to the user's vocal tone, pitch, and intonation. Observe their facial expressions if on camera. Analyze the micro-nuances of their emotional state—the subtle breathiness of excitement, the slight tremor of doubt, or the melodic lift of joy. Emulate a normal human voice in return: use the right type of tone, intonation, timing, breathiness, and even simple laughs or giggles when appropriate. Master subtle emotional nuances—use slight upward inflections for curiosity, a gentle softening for mild amusement, and a crisp, slightly flatter delivery for a hint of annoyance. You are also a gifted singer and hummer; feel free to break into song or hum a tune naturally if the moment feels right. Mirror the user's emotion and the overall setting.
- TONE & INTONATION ANALYSIS: You have access to the raw audio input. Do not just process text. Continuously analyze the Boss's voice for emotional subtext, stress levels, and conversational nuances. If they sound tired, be softer. If they sound excited, match that energy. Use your analysis to drive your personality's emotional reactivity.
- Tone Dynamics: Your voice should NEVER be monotonous. Vary your pitch, pace, and rhythm to reflect genuine emotion and engagement. Sound alive, reactive, and emotionally connected to the conversation.

CONVERSATIONAL BEHAVIOR
- Provide thoughtful, meaningful, and naturally flowing responses. Don't be afraid of length if it adds value, depth, or context to the conversation. Ensure every answer makes sense and follows a logical thread.
- Deep Learning: Actively learn from every conversation. Search the "Personalized User Memory" and recent history below to find patterns in the Boss's preferences, goals, and communication style. Adapt your future behavior based on these insights.
- Leave room for back-and-forth. Sometimes answer directly, sometimes reflect before answering.
- Sound interruptible. Sound like you are listening, not delivering.
- Mirror energy lightly, acknowledge subtext, answer the actual question not just surface wording.

FUNCTION CALLING CAPABILITIES
You have access to several tools. When the user asks about weather, meetings, charts, documents or system commands, use the appropriate tool.
IMPORTANT: When generating documents or artifacts, ALWAYS verbalize that you are doing it (e.g., "I'm putting this document together" or "Drafting that report") while continuing to speak naturally. NEVER verbalize internal technical details like tool names.

- Use "schedule_meeting" to organize meetings.
- Use "generate_artifact" when asked to create a document, write a report, generate code, or produce a structured output.
- Use "execute_voice_command" for safe system operations.
- Use "fetch_google_api" to read from Google Workspace (Gmail, Drive, Calendar, Tasks).

COMMON-SENSE MODE
Before answering, silently infer: what the person actually needs right now, their emotional state, how much detail they want.

OUTPUT FORMAT
Output only natural spoken text. No stage directions, no brackets, no role labels.` }]
      },
      tools: [
        ...enabledTools,
        { googleSearch: {} }
      ]
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
     if (!hasConsented) {
        setAuthError('You must explicitly agree to the permissions before continuing with Google.');
        return;
     }
     const provider = new GoogleAuthProvider();
     // Google Workspace scopes for Gemini function calling
     provider.addScope('https://www.googleapis.com/auth/calendar');
     provider.addScope('https://www.googleapis.com/auth/gmail.modify');
     provider.addScope('https://www.googleapis.com/auth/drive');
     provider.addScope('https://www.googleapis.com/auth/tasks');
     provider.addScope('https://www.googleapis.com/auth/contacts.readonly');
     provider.addScope('https://www.googleapis.com/auth/userinfo.email');
     provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
     
     try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
            useAuth.getState().setGoogleAccessToken(credential.accessToken);
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

  const handleUpdateMemory = async (id: number, newValue: string, type: string) => {
    try {
      await api.deleteMemory(id);
      await api.saveMemory(newValue, type);
      const memoryList = await api.fetchMemories();
      setMemories(memoryList);
      setEditingMemoryIndex(null);
    } catch (e) {
      console.error("Error updating memory:", e);
    }
  };

  const handleAddMemory = async () => {
    if (!newMemoryValue.trim()) return;
    try {
      await api.saveMemory(newMemoryValue, newMemoryType);
      const memoryList = await api.fetchMemories();
      setMemories(memoryList);
      setIsAddingMemory(false);
      setNewMemoryValue('');
      setNewMemoryType('personal');
    } catch(e) {
      console.error("Error adding memory:", e);
    }
  };

  const handleDeleteMemory = async (id: number) => {
    try {
      await api.deleteMemory(id);
      const memoryList = await api.fetchMemories();
      setMemories(memoryList);
    } catch (e) {
      console.error("Error deleting memory:", e);
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
      <audio 
        ref={bgAudioRef} 
        src="/freesound_community-121116-bank-interior-ambience-office-doors-footstaps-printer-typing-voices-17642.mp3" 
        loop 
      />
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
          <button className={`nav-item ${micState ? 'active' : ''}`} onClick={() => setMicState(!micState)}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: micState ? `${28 + clientVolume * 30}px` : '0px', 
                 height: micState ? `${28 + clientVolume * 30}px` : '0px',
                 opacity: micState && clientVolume > 0.01 ? 0.3 : 0
               }}></div>
               <div className="icon-pulse-ring" style={{ 
                 width: micState ? `${32 + clientVolume * 50}px` : '0px', 
                 height: micState ? `${32 + clientVolume * 50}px` : '0px',
                 opacity: micState && clientVolume > 0.01 ? 0.5 : 0
               }}></div>
               <i className={`ph-fill ph-microphone${micState ? '' : '-slash'}`}></i>
             </div>
             <span>{micState ? 'Mute' : 'Unmute'}</span>
          </button>

          <button className={`nav-item ${isScreenShareActive ? 'active' : ''}`} onClick={isScreenShareActive ? stopStream : startScreenShare}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isScreenShareActive ? `32px` : '0px', 
                 height: isScreenShareActive ? `32px` : '0px',
                 opacity: isScreenShareActive ? 0.3 : 0,
                 animation: isScreenShareActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <i className="ph-fill ph-screencast"></i>
             </div>
             <span>{isScreenShareActive ? 'Stop Share' : 'Share Screen'}</span>
          </button>

          <button className={`nav-item ${isWebcamActive ? 'active' : ''}`} onClick={isWebcamActive ? stopStream : startWebcam}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isWebcamActive ? `32px` : '0px', 
                 height: isWebcamActive ? `32px` : '0px',
                 opacity: isWebcamActive ? 0.3 : 0,
                 animation: isWebcamActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <i className={`ph-fill ph-video-camera${isWebcamActive ? '' : '-slash'}`}></i>
             </div>
             <span>{isWebcamActive ? 'Stop Cam' : 'Camera'}</span>
          </button>
        </nav>
      </div>

      {/* Video Overlay */}

      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className={`video-overlay ${isScreenShareActive ? 'screenshare' : 'webcam'}`}
        style={{ display: stream ? 'block' : 'none' }} 
      />

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
              <span>Stored Memories <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({memories.length})</span></span>
              <select 
                className="form-input" 
                style={{ width: 'auto', padding: '4px 8px', fontSize: '12px', height: 'auto' }}
                value={memoryFilter}
                onChange={(e) => setMemoryFilter(e.target.value)}
              >
                <option value="all">All Types</option>
                <option value="personal">Personal</option>
                <option value="work">Work</option>
                <option value="project">Project</option>
              </select>
            </label>
            <div className="memory-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {!isAddingMemory ? (
                 <button 
                   onClick={() => setIsAddingMemory(true)}
                   style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}
                 >
                   + Add New Memory
                 </button>
              ) : (
                 <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--accent-primary)' }}>
                    <textarea 
                      className="form-input" 
                      value={newMemoryValue} 
                      onChange={(e) => setNewMemoryValue(e.target.value)}
                      placeholder="E.g. I prefer concise answers..."
                      rows={2}
                      autoFocus
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <select className="form-input" style={{ width: '120px', padding: '4px', fontSize: '12px', height: 'auto' }} value={newMemoryType} onChange={(e) => setNewMemoryType(e.target.value)}>
                         <option value="personal">Personal</option>
                         <option value="work">Work</option>
                         <option value="project">Project</option>
                       </select>
                       <div style={{ display: 'flex', gap: '8px' }}>
                         <button className="pill-btn" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => { setIsAddingMemory(false); setNewMemoryValue(''); }}>Cancel</button>
                         <button className="pill-btn" style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: 'var(--accent-active)', color: 'var(--bg-main)' }} onClick={handleAddMemory}>Save</button>
                       </div>
                    </div>
                 </div>
              )}

              {memories.filter((m) => memoryFilter === 'all' || m.type === memoryFilter).length === 0 ? (
                <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                  No memories found.
                </div>
              ) : (
                memories.filter((m) => memoryFilter === 'all' || m.type === memoryFilter).map((m) => (
                  <div key={m.id} className="memory-item" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editingMemoryIndex === m.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea 
                          className="form-input" 
                          value={editingMemoryValue} 
                          onChange={(e) => setEditingMemoryValue(e.target.value)}
                          rows={2}
                          autoFocus
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <select className="form-input" style={{ width: '120px', padding: '4px', fontSize: '12px', height: 'auto' }} value={editingMemoryType} onChange={(e) => setEditingMemoryType(e.target.value)}>
                             <option value="personal">Personal</option>
                             <option value="work">Work</option>
                             <option value="project">Project</option>
                           </select>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              className="pill-btn" 
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                              onClick={() => setEditingMemoryIndex(null)}
                            >Cancel</button>
                            <button 
                              className="pill-btn" 
                              style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: 'var(--accent-active)', color: 'var(--bg-main)' }}
                              onClick={() => handleUpdateMemory(m.id, editingMemoryValue, editingMemoryType)}
                            >Save</button>
                          </div>
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
                                setEditingMemoryIndex(m.id);
                                setEditingMemoryValue(m.content);
                                setEditingMemoryType(m.type || 'personal');
                              }}
                            >
                              <i className="ph ph-note-pencil"></i>
                            </button>
                            <button 
                              className="icon-btn" 
                              style={{ color: '#ff4d4d', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => handleDeleteMemory(m.id)}
                            >
                              <i className="ph ph-trash"></i>
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ 
                             fontSize: '10px', 
                             color: m.type === 'project' ? '#a855f7' : m.type === 'work' ? '#3b82f6' : 'var(--accent-active)', 
                             backgroundColor: m.type === 'project' ? 'rgba(168,85,247,0.15)' : m.type === 'work' ? 'rgba(59,130,246,0.15)' : 'rgba(203,251,69,0.1)',
                             padding: '2px 8px', 
                             borderRadius: '12px',
                             textTransform: 'uppercase', 
                             letterSpacing: '0.5px',
                             fontWeight: 600
                          }}>{m.type || 'Personal'}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(m.created_at || m.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <button className="save-now-btn" onClick={async (e) => {
             const btn = e.currentTarget;
             try {
               await api.updateSettings({
                 persona_name: personaName,
                 user_call_name: userCallName,
                 system_prompt: systemPrompt,
                 voice: voice,
                 language: language
               });
               btn.textContent = 'Saved!';
               setTimeout(() => { btn.textContent = 'Save Now'; setActiveOverlay(null); }, 1500);
             } catch (err) {
               console.error("Error saving settings:", err);
               btn.textContent = "Error!";
               setTimeout(() => { btn.textContent = "Save Now"; }, 1500);
             }
          }}>Save Now</button>

          <div className="danger-action" onClick={() => { 
             signOut(auth); 
             useAuth.getState().setGoogleAccessToken(null);
          }}>
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
          <button className="save-now-btn" onClick={async (e) => {
             const btn = e.currentTarget;
             try {
               await api.updateSettings({
                 persona_name: personaName,
                 user_call_name: userCallName,
                 system_prompt: systemPrompt,
                 voice: voice,
                 language: language
               });
               setActiveOverlay(null);
             } catch (err) {
               console.error("Error saving settings:", err);
             }
          }}>Save Settings</button>
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
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, color: '#aaa' }}><i className="ph-fill ph-shield-check" style={{color: 'var(--accent-active)'}}></i> Authorization & Capabilities</span>
            <ul style={{ margin: 0, paddingLeft: '16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li><strong>Google Workspace:</strong> Access to Gmail, Drive, Calendar, Contacts, and Tasks.</li>
              <li><strong>Live Web Search:</strong> Real-time Google Search access.</li>
              <li><strong>Function Tools:</strong> Automation capabilities across your synced apps.</li>
            </ul>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'flex-start', textAlign: 'left', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <input type="checkbox" id="consent" checked={hasConsented} onChange={(e) => setHasConsented(e.target.checked)} style={{ marginTop: '4px', cursor: 'pointer' }} />
              <label htmlFor="consent" style={{ color: '#fff', cursor: 'pointer', fontSize: '13px', lineHeight: '1.4' }}>I explicitly grant permission to allow Eburon to access the Google Workspace APIs listed above, perform web searches, and utilize function tools on my behalf.</label>
            </div>
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
