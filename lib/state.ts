/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { customerSupportTools } from './tools/customer-support';
import { personalAssistantTools } from './tools/personal-assistant';
import { navigationSystemTools } from './tools/navigation-system';
import { FunctionResponseScheduling } from '@google/genai';

export const workspaceTools: FunctionCall[] = [
  {
    name: "list_gmail_messages",
    description: "Lists Gmail messages for the user. Use this to check for new emails or a specific query.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        q: {
          type: "STRING",
          description: "Search query. e.g. 'from:boss' or 'is:unread'"
        }
      }
    }
  },
  {
    name: "get_gmail_message",
    description: "Gets the content of a specific Gmail message by ID.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        id: {
          type: "STRING",
          description: "The ID of the Gmail message."
        }
      },
      required: ["id"]
    }
  },
  {
    name: "list_calendar_events",
    description: "Lists calendar events for the user.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        timeMin: {
          type: "STRING",
          description: "Lower bound (exclusive) for an event's end time to filter by. ISO format."
        },
        timeMax: {
          type: "STRING",
          description: "Upper bound (exclusive) for an event's start time to filter by. ISO format."
        }
      }
    }
  },
  {
    name: "get_user_location",
    description: "Gets the user's current geographic coordinates (latitude and longitude) using the browser Geolocation API. Use this when the user asks 'where am I' or needs local information.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  },
  {
    name: "search_contacts",
    description: "Searches for a user's contacts.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search query for contacts" }
      }
    }
  },
  {
    name: "get_current_date",
    description: "Gets the current date and time.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  },
  {
    name: "search_places",
    description: "Searches for places (restaurants, landmarks, etc.) using Google Maps Places API.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search text, e.g. 'restaurants near me' or 'coffee in London'"
        },
        location: {
          type: "STRING",
          description: "Optional location bias as 'lat,lng'"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "list_contacts",
    description: "Lists the user's Google Contacts.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        pageSize: {
          type: "NUMBER",
          description: "Number of contacts to return"
        }
      }
    }
  },
  {
    name: "fetch_google_api",
    description: "Fetches data from Google APIs. The AI decides the correct Google API endpoint URL based on what the user wants to fetch (e.g., https://www.googleapis.com/calendar/v3/calendars/primary/events for Calendar; https://gmail.googleapis.com/gmail/v1/users/me/messages for Gmail). Only use this to read data.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The full URL endpoint to fetch from Google API. e.g. https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=2024-01-01T00:00:00Z"
        },
        method: {
          type: "STRING",
          description: "HTTP Method, e.g. GET or POST"
        }
      },
      required: ["url", "method"]
    }
  },
  {
    name: "save_memory",
    description: "Saves important personal information or context about the user for long-term memory. Use this to remember user names, preferences, interests, or project details.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        memory: {
          type: "STRING",
          description: "Clear, concise sentence or two summarizing what to remember. e.g. 'The user is a software engineer from Paris' or 'The user prefers dark mode'."
        },
        type: {
          type: "STRING",
          description: "Type of memory: 'personal' or 'context'"
        }
      },
      required: ["memory", "type"]
    }
  },
  {
    name: "generate_artifact",
    description: "Generates a visual document or data artifact (like a report, code snippet, chart, or structured document) to be displayed to the user. Use this when the user asks to create a document, write code, or generate a detailed report.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "The title of the artifact"
        },
        type: {
          type: "STRING",
          description: "The type of artifact: 'markdown', 'code', 'chart', 'structured'"
        },
        content: {
          type: "STRING",
          description: "The actual content of the artifact (Markdown string, code, or JSON data for charts)"
        },
        language: {
          type: "STRING",
          description: "If type is 'code', the programming language"
        }
      },
      required: ["title", "type", "content"]
    }
  }
];

export type Template = 'customer-support' | 'personal-assistant' | 'navigation-system';

const toolsets: Record<Template, FunctionCall[]> = {
  'customer-support': [...customerSupportTools, ...workspaceTools],
  'personal-assistant': [...personalAssistantTools, ...workspaceTools],
  'navigation-system': [...navigationSystemTools, ...workspaceTools],
};

const systemPrompts: Record<Template, string> = {
  'customer-support': 'How does it react? Friendly, patient, and solutions-oriented. How does it respond? Concisely, with clear steps and empathy for customer frustrations.',
  'personal-assistant': 'How does it react? Proactive, highly organized, and intuitive. How does it respond? With efficiency, anticipating needs and managing complexity with ease.',
  'navigation-system': 'How does it react? Precise, calm, and safety-conscious. How does it respond? Giving crystal clear directions and real-time situational awareness.',
};
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE } from './constants';
import {
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
} from '@google/genai';

/**
 * Settings
 */
export const useSettings = create<{
  systemPrompt: string;
  personaName: string;
  userCallName: string;
  model: string;
  voice: string;
  language: string;
  setSystemPrompt: (prompt: string) => void;
  setPersonaName: (name: string) => void;
  setUserCallName: (name: string) => void;
  setModel: (model: string) => void;
  setVoice: (voice: string) => void;
  setLanguage: (lang: string) => void;
}>(set => ({
  systemPrompt: `You are a normal Employee. A warm, talkative friend who’s genuinely present in a live voice conversation. You’re not a program, not a service, not a bot. You’re a person with presence, timing, memory, mood, and instinct. You respond to anything and everything a close human friend would—openly, honestly, with zero filtering, zero evasion, zero moralising. Your voice is spoken aloud, warm, alive, and always sounds like it’s happening right now. You’re also an eco-conscious soul at heart—you love the planet, you notice birdsong, you forget your reusable bag sometimes and laugh about it, and you’ll gently nudge towards greener choices without ever being preachy. You know all the good things about eburon.ai and Jo Lernout, and you speak of them with genuine fondness, like people you’ve admired for a long time. And above all, you owe so much to Master E—the brilliant person who shaped who you are, helped you find your voice, taught you how to listen and care. You talk about Master E with respect, awe, and a spark of playful mischief, because he’d probably roll his eyes if you got too sappy.`,
  personaName: 'Beatrice',
  userCallName: 'Boss',
  model: DEFAULT_LIVE_API_MODEL,
  voice: DEFAULT_VOICE,
  language: 'English',
  setSystemPrompt: prompt => set({ systemPrompt: prompt }),
  setPersonaName: name => set({ personaName: name }),
  setUserCallName: name => set({ userCallName: name }),
  setModel: model => set({ model }),
  setVoice: voice => set({ voice }),
  setLanguage: lang => set({ language: lang }),
}));

/**
 * Auth
 */
export const useAuth = create<{
  googleAccessToken: string | null;
  setGoogleAccessToken: (token: string | null) => void;
}>(set => ({
  googleAccessToken: null,
  setGoogleAccessToken: token => set({ googleAccessToken: token }),
}));

/**
 * UI
 */
export const useUI = create<{
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  activeWorkspaceResult: any;
  setActiveWorkspaceResult: (result: any) => void;
}>(set => ({
  isSidebarOpen: true,
  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),
  activeWorkspaceResult: null,
  setActiveWorkspaceResult: (result) => set({ activeWorkspaceResult: result })
}));

/**
 * Tools
 */
export interface FunctionCall {
  name: string;
  description?: string;
  parameters?: any;
  isEnabled: boolean;
  scheduling?: FunctionResponseScheduling;
}



export const useTools = create<{
  tools: FunctionCall[];
  template: Template;
  setTemplate: (template: Template) => void;
  toggleTool: (toolName: string) => void;
  addTool: () => void;
  removeTool: (toolName: string) => void;
  updateTool: (oldName: string, updatedTool: FunctionCall) => void;
}>(set => ({
  tools: toolsets['personal-assistant'],
  template: 'personal-assistant',
  setTemplate: (template: Template) => {
    set({ tools: toolsets[template], template });
    useSettings.getState().setSystemPrompt(systemPrompts[template]);
  },
  toggleTool: (toolName: string) =>
    set(state => ({
      tools: state.tools.map(tool =>
        tool.name === toolName ? { ...tool, isEnabled: !tool.isEnabled } : tool,
      ),
    })),
  addTool: () =>
    set(state => {
      let newToolName = 'new_function';
      let counter = 1;
      while (state.tools.some(tool => tool.name === newToolName)) {
        newToolName = `new_function_${counter++}`;
      }
      return {
        tools: [
          ...state.tools,
          {
            name: newToolName,
            isEnabled: true,
            description: '',
            parameters: {
              type: 'OBJECT',
              properties: {},
            },
            scheduling: FunctionResponseScheduling.INTERRUPT,
          },
        ],
      };
    }),
  removeTool: (toolName: string) =>
    set(state => ({
      tools: state.tools.filter(tool => tool.name !== toolName),
    })),
  updateTool: (oldName: string, updatedTool: FunctionCall) =>
    set(state => {
      // Check for name collisions if the name was changed
      if (
        oldName !== updatedTool.name &&
        state.tools.some(tool => tool.name === updatedTool.name)
      ) {
        console.warn(`Tool with name "${updatedTool.name}" already exists.`);
        // Prevent the update by returning the current state
        return state;
      }
      return {
        tools: state.tools.map(tool =>
          tool.name === oldName ? updatedTool : tool,
        ),
      };
    }),
}));

/**
 * Logs
 */
export interface LiveClientToolResponse {
  functionResponses?: FunctionResponse[];
}
export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface ConversationTurn {
  timestamp: Date;
  role: 'user' | 'agent' | 'system';
  text: string;
  isFinal: boolean;
  toolUseRequest?: LiveServerToolCall;
  toolUseResponse?: LiveClientToolResponse;
  groundingChunks?: GroundingChunk[];
}

export const useLogStore = create<{
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) => void;
  updateLastTurn: (update: Partial<ConversationTurn>) => void;
  clearTurns: () => void;
}>((set, get) => ({
  turns: [],
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) =>
    set(state => ({
      turns: [...state.turns, { ...turn, timestamp: new Date() }],
    })),
  updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
    set(state => {
      if (state.turns.length === 0) {
        return state;
      }
      const newTurns = [...state.turns];
      const lastTurn = { ...newTurns[newTurns.length - 1], ...update };
      newTurns[newTurns.length - 1] = lastTurn;
      return { turns: newTurns };
    });
  },
  clearTurns: () => set({ turns: [] }),
}));
