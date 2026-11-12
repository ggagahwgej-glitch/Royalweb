export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'openrouter'
  | 'custom'
  | 'ollama'
  | 'local';

export interface AiPart {
  type: 'text' | 'image';
  text?: string;
  mimeType?: string;
  dataBase64?: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiPart[];
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiResponse {
  text: string;
  model: string;
  provider: ProviderId;
  usage: AiUsage;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  requiresKey: boolean;
  supportsVision: boolean;
  defaultModel: string;
  chat(messages: AiMessage[], opts?: { maxTokens?: number; json?: boolean; temperature?: number; model?: string }): Promise<AiResponse>;
}

export interface GeneratedContent {
  platform: string;
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
  cta: string;
  altText: string;
  extra: Record<string, unknown>;
}

export interface PosterAnalysis {
  summary: string;
  service: string;
  offer: string;
  audience: string;
  cta: string;
  brandColors: string[];
  textOnPoster: string;
  /** Where the analysis came from — never presented as AI when it is not. */
  source: 'vision-model' | 'local-image-analysis';
  provider?: string;
  model?: string;
  image: {
    width: number;
    height: number;
    format: string;
    orientation: string;
    dominantColor: string;
    brightness: number;
  };
}

export class AiNotConfiguredError extends Error {
  constructor(message = 'No AI provider is configured') {
    super(message);
    this.name = 'AiNotConfiguredError';
  }
}
